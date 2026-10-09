// Headless API gateway for serving individual Ozentime update files.
// Place inside /api/check-update.js or /pages/api/check-update.js in your Vercel deployment.

import crypto from 'crypto';

// 16-byte static fallback key shared with the C++ updater
const AES_KEY = Buffer.from(process.env.OZENTIME_AES_KEY || 'OzentimeUpdater1', 'utf8');

/**
 * Helper to encrypt plain text logs using AES-128-GCM
 * Binary Layout: [ 12-byte Nonce ] [ 16-byte Auth Tag ] [ Ciphertext ]
 */
export function encryptLogPayload(plainTextData) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-128-gcm', AES_KEY, iv);
  const formattedInput = `OZEN_LOG_V1\n${plainTextData}`;

  let encrypted = cipher.update(formattedInput, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Allow repository details to be passed dynamically via query or env vars
  const repoOwner = req.query.owner || process.env.GITHUB_REPO_OWNER;
  const repoName = req.query.repo || process.env.GITHUB_REPO_NAME || 'ozentime-antivirus-updater';
  const requestedFile = req.query.file;

  if (!repoOwner) {
    return res.status(400).json({
      error: 'Missing GITHUB_REPO_OWNER environment variable or ?owner= query parameter.'
    });
  }

  try {
    const headers = {
      'User-Agent': 'Ozentime-Vercel-Gateway/1.0',
      'Accept': 'application/vnd.github.v3+json',
    };

    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    // Dynamic GitHub API target
    const ghUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;
    const gh = await fetch(ghUrl, { headers });

    if (!gh.ok) {
      const errorData = await gh.json().catch(() => ({}));
      return res.status(gh.status).json({
        error: 'Failed to query GitHub release',
        target_repo: `${repoOwner}/${repoName}`,
        github_status: gh.status,
        github_message: errorData.message || 'Check repository visibility and release state'
      });
    }

    const release = await gh.json();

    // SCENARIO 1: Direct asset redirect by filename
    if (requestedFile) {
      const asset = (release.assets || []).find((a) => a.name === requestedFile);

      if (!asset) {
        return res.status(404).json({ error: `File '${requestedFile}' not found in release assets` });
      }

      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
      return res.redirect(302, asset.browser_download_url);
    }

    // SCENARIO 2: Return file manifest listing
    const files = (release.assets || []).map((asset) => ({
      name: asset.name,
      size_bytes: asset.size,
      download_url: `/api/check-update?file=${encodeURIComponent(asset.name)}`
    }));

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

    return res.status(200).json({
      status: 'success',
      repository: `${repoOwner}/${repoName}`,
      latest_version: release.tag_name,
      published_at: release.published_at,
      target_folder: 'ozentime download',
      total_files: files.length,
      files,
      release_notes: release.body || ''
    });

  } catch (error) {
    return res.status(500).json({ error: 'Internal Gateway Error', details: error.message });
  }
}
