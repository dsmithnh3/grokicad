<p align="center">
  <img src="./images/groki.png" alt="GroKi" width="600">
</p>

<div align="center">
  <a href="https://github.com/grokicad/grokicad/actions/workflows/ci.yml">
    <img src="https://github.com/grokicad/grokicad/actions/workflows/ci.yml/badge.svg?branch=main"
      alt="CI status" />
  </a>
  <a href="#license">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square"
      alt="License" />
  </a>
</div>

<div align="center">
  <h3>
    <a href="https://grokicad.com"> Website </a>
    <span> | </span>
    <a href="https://beta.grokicad.com"> Beta </a>
  </h3>
</div>

<br>

**AI-powered KiCad schematic intelligence.** GroKi transforms complex hardware schematics into interactive, AI-explained experiences. Upload any KiCad project and get instant component analysis, circuit explanations, and part recommendations—all powered by Grok AI.

## ⭐️ Features

- **Interactive visualization**: WebGL-based schematic viewer with pan, zoom, and component highlighting
- **AI-powered analysis**: Grok integration for component explanations and circuit understanding
- **Smart part search**: Integrated DigiKey OAuth search with obsolescence detection
- **Edge-deployed**: Globally distributed on Cloudflare Workers for low-latency access
- **Zero dependencies**: Lightweight TypeScript viewer, no React or heavy frameworks

## 🎨 Interactive Schematic Viewer

Built on KiCanvas with WebGL rendering. Navigate complex multi-sheet designs, highlight nets, and explore your hardware designs in the browser.

<p align="center">
  <img src="./images/groki-intro.png" alt="GroKi Interactive Viewer" width="700">
</p>

## 🚀 Quickstart

### Prerequisites
- Bun (for development)
- Node.js 18+ (if not using Bun)

### Run locally

```bash
cd web
bun install
bun run dev
# Open http://localhost:8787
```

### Build for production

```bash
cd web
bun run build
```

## 🌐 Deployment

### Deploy to Cloudflare Workers

```bash
cd web
bunx wrangler deploy --env production
```

### Beta Environment

```bash
bunx wrangler deploy --env beta
# Deployed to beta.grokicad.com
```

## 📦 Project Structure

```
grokicad/
├── web/               # TypeScript frontend & Cloudflare Worker
│   ├── src/           # Viewer implementation (KiCanvas-based)
│   ├── worker/        # Cloudflare Worker (OAuth, API proxy)
│   └── wrangler.jsonc # Deployment configuration
├── kicad-example-files/  # Demo KiCad projects
│   ├── BMS/          # Battery management system
│   └── Smart Watch/  # Smartwatch hardware
└── grokprompts/     # AI system prompts
```

## 🧪 Example Projects

Try these included KiCad projects:

- **uBMS-2**: Battery management system with multiple sheets
- **Smart Watch**: Complete smartwatch hardware design

Both are in `kicad-example-files/` for instant demos.

## 🤝 Contributing

We welcome contributions! Please open an issue or PR on [GitHub](https://github.com/grokicad/grokicad).

## 👥 Team

- **[Clement Hathaway](https://x.com/KodaClement)** - [@KodaClement](https://x.com/KodaClement)
- **[Ernest Yeung](https://x.com/ernestyalumni)** - [@ernestyalumni](https://x.com/ernestyalumni)
- **[Evan Hekman](https://x.com/unhinged_evan)** - [@unhinged_evan](https://x.com/unhinged_evan)
- **[Julian Carrier](https://x.com/juliankc)** - [@juliankc](https://x.com/juliankc)

## 🙏 Acknowledgments

Built on:

- **[KiCanvas](https://github.com/theacodes/kicanvas)** - WebGL schematic viewer
- **[Grok](https://x.ai)** - AI analysis engine
- **[Cloudflare Workers](https://workers.cloudflare.com)** - Edge deployment platform

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](web/LICENSE.md) file for details.

---

<p align="center">
  Made with ❤️ for the hardware community
</p>
