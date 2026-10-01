// Headless API gateway for serving individual Ozentime update files.
// Place inside /api/check-update.js in your Vercel deployment.

export default async function handler(req, res) {
  // Lock down to GET requests only
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const GITHUB_REPO_OWNER = 'YourGitHubUsername'; // Replace with your GitHub username
  const GITHUB_REPO_NAME = 'Ozentime';           // Replace with your repository name
  const { file: requestedFile } = req.query;

  try {
    const requestHeaders = {
      'User-Agent': 'Ozentime-Vercel-Gateway/1.0',
      'Accept': 'application/vnd.github.v3+json',
    };

    if (process.env.GITHUB_TOKEN) {
      requestHeaders['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    // Query GitHub's latest release endpoint
    const ghResponse = await fetch(
      `https://api.github.com/repos/\({GITHUB_REPO_OWNER}/\){GITHUB_REPO_NAME}/releases/latest`,
      { headers: requestHeaders }
    );

    if (!ghResponse.ok) {
      return res.status(ghResponse.status).json({
        error: 'Failed to query release metadata from GitHub',
        status: ghResponse.status
      });
    }

    const releaseData = await ghResponse.json();

    // SCENARIO 1: If a specific file is requested, proxy and stream the asset directly
    if (requestedFile) {
      const targetAsset = releaseData.assets.find(
        (asset) => asset.name === requestedFile
      );

      if (!targetAsset) {
        return res.status(404).json({ error: `File '${requestedFile}' not found in release.` });
      }

      // Download the asset from GitHub's redirect URL
      const fileResponse = await fetch(targetAsset.browser_download_url);
      if (!fileResponse.ok) {
        return res.status(fileResponse.status).json({ error: 'Failed to stream file from GitHub' });
      }

      const fileBuffer = await fileResponse.arrayBuffer();

      // Return as octet-stream for raw binary download
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${targetAsset.name}"`);
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

      return res.status(200).send(Buffer.from(fileBuffer));
    }

    // SCENARIO 2: If no file is specified, return JSON listing all individual release files
    const fileList = releaseData.assets.map((asset) => ({
      name: asset.name,
      size_bytes: asset.size,
      download_url: `/api/check-update?file=${encodeURIComponent(asset.name)}`
    }));

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

    // Return pure JSON — NO HTML UI rendered
    return res.status(200).json({
      status: 'success',
      latest_version: releaseData.tag_name,
      published_at: releaseData.published_at,
      target_folder: 'ozentime download',
      total_files: fileList.length,
      files: fileList,
      release_notes: releaseData.body || 'No release notes provided.'
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Internal Gateway Error',
      details: error.message
    });
  }
}
