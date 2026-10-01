// Headless API gateway for serving individual Ozentime update files.
// Place inside /api/check-update.js or /pages/api/check-update.js in your Vercel deployment.

export default async function handler(req, res) {
  // Lock down endpoint to GET requests only
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // --- CONFIGURATION ---
  const GITHUB_REPO_OWNER = 'YourGitHubUsername'; // Replace with your GitHub username
  const GITHUB_REPO_NAME = 'Ozentime';           // Replace with your repository name
  const requestedFile = req.query.file;

  try {
    const headers = {
      'User-Agent': 'Ozentime-Vercel-Gateway/1.0',
      'Accept': 'application/vnd.github.v3+json',
    };

    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    // Query GitHub's official REST API for the latest published release
    const gh = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`,
      { headers }
    );

    if (!gh.ok) {
      return res.status(gh.status).json({ error: 'Failed to query GitHub release' });
    }

    const release = await gh.json();

    // SCENARIO 1: Stream specific file if requested by name
    if (requestedFile) {
      const asset = (release.assets || []).find((a) => a.name === requestedFile);
      if (!asset) {
        return res.status(404).json({ error: 'File not in release' });
      }

      const file = await fetch(asset.browser_download_url);
      if (!file.ok) {
        return res.status(file.status).json({ error: 'Failed to stream file' });
      }

      const buf = Buffer.from(await file.arrayBuffer());
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${asset.name}"`);
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

      return res.status(200).send(buf);
    }

    // SCENARIO 2: Return file listing JSON for individual downloads into 'ozentime download'
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
