# Project Rules

## Deployment
- VPS: `easterseals@vps54643.dreamhostps.com`
- Host: DreamHost VPS
- Domain: `es2.randall.codes`
- App dir: `~/app`
- Web root: `~/es2.randall.codes`
- Node managed by: mise (node@20)
- Process manager: pm2 (app name: `es2-api`, cluster mode)

### Deployment
Automatic via GitHub Actions on push/merge to `main`. See `.github/workflows/deploy.yml`.

### DreamHost proxy
`/api` → `localhost:8080` (configured in DreamHost panel)
