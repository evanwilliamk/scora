export const landingPageHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SCORA — Fitness Coaching</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 60px 40px;
      max-width: 600px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .logo {
      font-size: 72px;
      font-weight: 900;
      color: #667eea;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 36px;
      margin-bottom: 16px;
      color: #333;
    }
    .tagline {
      font-size: 18px;
      color: #666;
      margin-bottom: 40px;
      line-height: 1.6;
    }
    .features {
      text-align: left;
      margin: 40px 0;
      padding: 30px;
      background: #f8f9fa;
      border-radius: 12px;
    }
    .features li {
      list-style: none;
      padding: 12px 0;
      font-size: 16px;
      color: #555;
    }
    .features li:before {
      content: "✓ ";
      color: #667eea;
      font-weight: bold;
      margin-right: 12px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 14px;
      color: #999;
    }
    a {
      color: #667eea;
      text-decoration: none;
      margin: 0 12px;
    }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">S</div>
    <h1>SCORA</h1>
    <p class="tagline">
      Your AI fitness coach that reads your body and adapts your training in real-time.
    </p>
    
    <ul class="features">
      <li>Daily posture reads powered by AI</li>
      <li>Real-time workout adaptation</li>
      <li>Integrates Strava, Oura, Apple Health</li>
      <li>Marketplace of human coaches</li>
    </ul>
    
    <div class="footer">
      <p>SCORA is in early access.</p>
      <p><a href="/privacy">Privacy Policy</a> • <a href="/terms">Terms of Service</a></p>
    </div>
  </div>
</body>
</html>
`;

export const privacyPolicyHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — SCORA</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f8f9fa;
      padding: 40px 20px;
      line-height: 1.8;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 { font-size: 32px; margin-bottom: 30px; color: #333; }
    h2 { font-size: 20px; margin-top: 30px; margin-bottom: 15px; color: #555; }
    p { margin-bottom: 15px; color: #666; }
    .last-updated { color: #999; font-size: 14px; margin-bottom: 30px; }
    a { color: #667eea; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Privacy Policy</h1>
    <p class="last-updated">Last updated: July 1, 2026</p>
    
    <h2>1. Introduction</h2>
    <p>
      SCORA ("we," "us," or "our") operates the SCORA mobile application and website (the "Service"). 
      This page informs you of our policies regarding the collection, use, and disclosure of personal data when you use our Service.
    </p>
    
    <h2>2. Information Collection and Use</h2>
    <p>
      We collect information you provide directly (account creation, profile data) and automatically through your use of the Service 
      (fitness data from integrated services like Strava, Oura, and Apple Health).
    </p>
    
    <h2>3. Data from Third Parties</h2>
    <p>
      With your authorization, we access fitness data from:
    </p>
    <ul style="margin-left: 20px; color: #666;">
      <li>Strava (activities, performance metrics)</li>
      <li>Oura Ring (sleep, HRV, recovery data)</li>
      <li>Apple Health (general health metrics)</li>
    </ul>
    
    <h2>4. Data Security</h2>
    <p>
      We implement appropriate technical and organizational measures to protect your personal data against unauthorized processing, 
      accidental loss, destruction, or damage.
    </p>
    
    <h2>5. Your Rights</h2>
    <p>
      You have the right to access, correct, or delete your personal data at any time by contacting us at hello@scora.app.
    </p>
    
    <h2>6. Contact Us</h2>
    <p>
      If you have questions about this Privacy Policy, please contact us at <a href="mailto:hello@scora.app">hello@scora.app</a>.
    </p>
  </div>
</body>
</html>
`;

export const termsOfServiceHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service — SCORA</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f8f9fa;
      padding: 40px 20px;
      line-height: 1.8;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 { font-size: 32px; margin-bottom: 30px; color: #333; }
    h2 { font-size: 20px; margin-top: 30px; margin-bottom: 15px; color: #555; }
    p { margin-bottom: 15px; color: #666; }
    .last-updated { color: #999; font-size: 14px; margin-bottom: 30px; }
    a { color: #667eea; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Terms of Service</h1>
    <p class="last-updated">Last updated: July 1, 2026</p>
    
    <h2>1. Acceptance of Terms</h2>
    <p>
      By accessing and using SCORA, you accept and agree to be bound by the terms and provision of this agreement.
    </p>
    
    <h2>2. Use License</h2>
    <p>
      Permission is granted to temporarily download one copy of the materials (information or software) on SCORA's Service for personal, 
      non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:
    </p>
    <ul style="margin-left: 20px; color: #666;">
      <li>Modify or copy the materials</li>
      <li>Use the materials for any commercial purpose or for any public display</li>
      <li>Attempt to decompile or reverse engineer any software contained on the Service</li>
      <li>Remove any copyright or other proprietary notations from the materials</li>
      <li>Transfer the materials to another person or "mirror" the materials on any other server</li>
    </ul>
    
    <h2>3. Disclaimer</h2>
    <p>
      The materials on SCORA's Service are provided on an 'as is' basis. SCORA makes no warranties, expressed or implied, 
      and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, 
      fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.
    </p>
    
    <h2>4. Limitations</h2>
    <p>
      In no event shall SCORA or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, 
      or due to business interruption) arising out of the use or inability to use the materials on SCORA's Service, even if SCORA or an authorized 
      representative has been notified orally or in writing of the possibility of such damage.
    </p>
    
    <h2>5. Accuracy of Materials</h2>
    <p>
      The materials appearing on SCORA's Service could include technical, typographical, or photographic errors. SCORA does not warrant that any 
      of the materials on its Service are accurate, complete, or current.
    </p>
    
    <h2>6. Links</h2>
    <p>
      SCORA has not reviewed all of the sites linked to its Service and is not responsible for the contents of any such linked site. The inclusion 
      of any link does not imply endorsement by SCORA of the site. Use of any such linked website is at the user's own risk.
    </p>
    
    <h2>7. Modifications</h2>
    <p>
      SCORA may revise these terms of service for its Service at any time without notice. By using this Service, you are agreeing to be bound by 
      the then current version of these terms of service.
    </p>
    
    <h2>8. Governing Law</h2>
    <p>
      These terms and conditions are governed by and construed in accordance with the laws of the United States, and you irrevocably submit to 
      the exclusive jurisdiction of the courts in that location.
    </p>
    
    <h2>9. Contact</h2>
    <p>
      If you have any questions about these Terms of Service, please contact us at <a href="mailto:hello@scora.app">hello@scora.app</a>.
    </p>
  </div>
</body>
</html>
`;
