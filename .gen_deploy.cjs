// Generate MCP deployment code for Cloudflare Pages Direct Upload
const fs = require('fs');

const files = [
  { path: 'index.html', file: '/workspace/dist/index.html' },
  { path: 'assets/index-DpHVVHZf.css', file: '/workspace/dist/assets/index-DpHVVHZf.css' },
  { path: 'assets/index-_yJcv2fq.js', file: '/workspace/dist/assets/index-_yJcv2fq.js' },
];

// Read each file and base64 encode
const fileData = files.map(f => {
  const buf = fs.readFileSync(f.file);
  const b64 = buf.toString('base64');
  console.log(`${f.path}: ${buf.length} bytes -> ${b64.length} b64 chars`);
  return { path: f.path, b64 };
});

// Build the MCP code
let code = 'async () => {\n';
code += '  const PROJECT = "accounting-ai";\n';
code += '  const boundary = "----CFDeploy" + Date.now();\n';
code += '  const files = [';
for (const f of fileData) {
  code += `{ path: ${JSON.stringify(f.path)}, b64: ${JSON.stringify(f.b64)} },`;
}
code += '];\n';
code += `
  // Helper: decode base64 to Uint8Array
  function decodeB64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Build multipart/form-data body manually
  // Cloudflare Pages Direct Upload: each file is a part with name="<filepath>"
  let body = '';
  const enc = (s) => s;
  for (const f of files) {
    const bytes = decodeB64(f.b64);
    // Convert Uint8Array to binary string for multipart construction
    let binStr = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binStr += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    body += '--' + boundary + '\\r\\n';
    body += 'Content-Disposition: form-data; name="' + f.path + '"; filename="' + f.path.split('/').pop() + '"\\r\\n';
    body += 'Content-Type: application/octet-stream\\r\\n';
    body += '\\r\\n';
    body += binStr + '\\r\\n';
  }
  body += '--' + boundary + '--\\r\\n';

  const res = await cloudflare.request({
    method: "POST",
    path: '/accounts/' + accountId + '/pages/projects/' + PROJECT + '/deployments',
    body: body,
    contentType: 'multipart/form-data; boundary=' + boundary,
    rawBody: true
  });

  return {
    success: res.success,
    status: res.status,
    errors: res.errors,
    messages: res.messages,
    deployment: res.result ? {
      id: res.result.id,
      url: res.result.url,
      aliases: res.result.aliases,
      stages: res.result.stages,
      env_vars: res.result.env_vars ? Object.keys(res.result.env_vars) : []
    } : null
  };
}`;

fs.writeFileSync('/workspace/.deploy.cjs.txt', code);
console.log('Generated MCP code size:', code.length, 'bytes');
