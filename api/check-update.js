// Headless API gateway for serving individual Ozentime update files.
// Place inside /api/check-update.js or /pages/api/check-update.js in your Vercel deployment.

import crypto from 'crypto';

// --- CONFIGURATION ---
const GITHUB_REPO_OWNER = 'YourGitHubUsername'; // Replace with your GitHub username
const GITHUB_REPO_NAME = 'Ozentime';           // Replace with your repository name

// 16-byte key shared with C++ updater (Fallback: OzentimeUpdater1)
const AES_KEY = Buffer.from(process.env.OZENTIME_AES_KEY || 'OzentimeUpdater1', 'utf8');

/**
 * Helper to encrypt plain text logs using AES-128-GCM
 * Binary Layout: [ 12-byte Nonce ] [ 16-byte Auth Tag ] [ Ciphertext ]
 */
export function encryptLogPayload(plainTextData) {
  // 12-byte random Nonce (IV) generated per write
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-128-gcm', AES_KEY, iv);

  // Prepend mandatory header to plaintext
  const formattedInput = `OZEN_LOG_V1\n${plainTextData}`;

  let encrypted = cipher.update(formattedInput, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag(); // 16-byte Auth Tag

  // Pack binary sequence
  return Buffer.concat([iv, authTag, encrypted]);
}

export default async function handler(req, res) {
  // Lock down endpoint to GET requests only
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const requestedFile = req.query.file;

  try {
    const headers = {
      'User-Agent': 'Ozentime-Vercel-Gateway/1.0',
      'Accept': 'application/vnd.github.v3+json',
    };

    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    // SCENARIO 1: Serve a specific requested file via HTTP 302 Redirect
    if (requestedFile) {
      const gh = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`,
        { headers }
      );

      if (!gh.ok) {
        return res.status(gh.status).json({ error: 'Failed to query GitHub release' });
      }

      const release = await gh.json();
      const asset = (release.assets || []).find((a) => a.name === requestedFile);

      if (!asset) {
        return res.status(404).json({ error: 'File not in release' });
      }

      // 302 Redirect directly to GitHub CDN (bypasses Vercel payload limits & handles large files)
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
      return res.redirect(302, asset.browser_download_url);
    }

    // SCENARIO 2: Return file listing JSON for updater discovery
    const gh = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`,
      { headers }
    );

    if (!gh.ok) {
      return res.status(gh.status).json({ error: 'Failed to query GitHub release' });
    }

    const release = await gh.json();
    const files = (release.assets || []).map((asset) => ({
      name: asset.name,
      size_bytes: asset.size,
      download_url: `/api/check-update?file=${encodeURIComponent(asset.name)}`
    }));

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

    return res.status(200).json({
      status: 'success',
      latest_version: release.tag_name,
      published_at: release.published_at,
      target_folder: 'ozentime download',
      total_files: files.length,
      files,
      release_notes: release.body || ''
    });

  } catch (error) {
    return res.status(500).json({ error: 'Internal Gateway Error' });
  }
}
