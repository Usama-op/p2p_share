# P2P Share

A secure, serverless peer-to-peer file sharing web application built with WebRTC and PeerJS.

## Features
- **Zero Server Storage:** Files are sent directly between browsers.
- **Secure:** Uses WebRTC for peer-to-peer data transfer.
- **Fast:** Direct connections minimize latency.
- **Modern UI:** Clean, responsive design with real-time progress updates.

## How to use
1. Open the app in two different browser windows or on two different devices.
2. Share your ID with the other peer or paste their ID into the "Connect" field.
3. Once connected, select a file and click "Send".
4. The receiver will see a progress bar and a download link once the transfer is complete.

## Deployment to GitHub Pages
1. Create a new repository on GitHub.
2. Upload `index.html`, `style.css`, and `app.js` to the repository.
3. Go to **Settings > Pages**.
4. Select the `main` branch as the source and click **Save**.
5. Your app will be live at `https://<your-username>.github.io/<repo-name>/`.

## Technical Details
- **Signaling:** Uses [PeerJS](https://peerjs.com/) with its public signaling server.
- **Data Transfer:** WebRTC `RTCDataChannel`.
- **Connectivity:** Pre-configured with Google's STUN servers to bypass most firewalls.

## Troubleshooting Connections
WebRTC can sometimes be blocked by strict corporate or school firewalls. If you cannot connect:
1. **Use HTTPS:** GitHub Pages uses HTTPS by default, which is required for many WebRTC features.
2. **Same Browser Version:** Ensure both browsers are up to date.
3. **TURN Servers:** For the strongest possible connection that can bypass *any* firewall, you can add a **TURN server**. You can get a free TURN server from services like [Metered.ca](https://www.metered.ca/tools/openrelay/).
   - To add it, update the `iceServers` array in `app.js` with your TURN credentials.

