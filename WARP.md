# Project Rules

## Deployment
- VPS: `easterseals@vps54643.dreamhostps.com`
- Host: DreamHost VPS
- Domain: `es2.randall.codes`
- App dir: `~/app`
- Web root: `~/es2.randall.codes`
- Node managed by: mise (node@20)
- Process manager: pm2

### Deploy command
```bash
ssh easterseals@vps54643.dreamhostps.com 'export PATH="$HOME/.local/bin:$PATH" && eval "$(mise activate bash)" && cd ~/app && git pull && npm ci && npm run build && cp -r client/dist/* ~/es2.randall.codes/ && pm2 restart easterseals'
```

### Manual setup needed
Configure nginx proxy in DreamHost panel to forward `/api/*` to `localhost:3000`
