/**
 * Vercel Serverless Function: /api/submit-lead
 *
 * Why this exists:
 * Google Apps Script web app URLs (script.google.com/macros/s/.../exec)
 * do not return CORS headers, and they respond with a 302 redirect to a
 * script.googleusercontent.com content URL. A browser `fetch()` call made
 * directly from the landing page either gets blocked by CORS or returns an
 * "opaque" response that JavaScript cannot read — so the page can never
 * reliably know whether the submission actually succeeded.
 *
 * This function runs server-to-server (Vercel -> Apps Script), which has no
 * CORS restriction, follows the Apps Script redirect itself, and returns a
 * clean JSON response back to the browser so the landing page can show a
 * real success or real failure state.
 *
 * Configuration:
 * Set an environment variable APPS_SCRIPT_URL in your Vercel project
 * (Project Settings -> Environment Variables) pointing to your Apps Script
 * /exec URL. If it's not set, the URL below is used as a fallback.
 */

const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzNn8FFaaBfa38Tw-Rs2GXPHKeK_7zayVj3KBs8tTJ34Y8eCOeJAHv0Eko7mLXbitmE/exec';

module.exports = async function handler(req, res) {
  // Basic CORS headers (harmless for same-origin calls, useful if the form
  // is ever embedded/called from another domain).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'Method not allowed. Use POST.' });
    return;
  }

  const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL;

  // Vercel parses an `application/json` body into req.body automatically.
  // Still handle the case where it arrives as a raw string, defensively.
  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      res.status(400).json({ ok: false, message: 'Request body must be valid JSON.' });
      return;
    }
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    res.status(400).json({ ok: false, message: 'Missing or invalid request body.' });
    return;
  }

  try {
    const upstreamRes = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });

    const rawText = await upstreamRes.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      // Apps Script returned something that isn't JSON (e.g. an HTML error
      // page from a misconfigured deployment). Surface this clearly instead
      // of pretending it succeeded.
      res.status(502).json({
        ok: false,
        message: 'CRM backend returned an unexpected (non-JSON) response.',
        upstreamStatus: upstreamRes.status,
        rawPreview: rawText.slice(0, 500)
      });
      return;
    }

    // Forward the Apps Script backend's own ok/true/false verdict as-is.
    res.status(upstreamRes.ok ? 200 : 502).json(data);
  } catch (err) {
    res.status(502).json({
      ok: false,
      message:
        'Could not reach the CRM backend: ' +
        (err && err.message ? err.message : String(err))
    });
  }
};
