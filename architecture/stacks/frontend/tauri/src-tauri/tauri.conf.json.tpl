{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "{{appId}}",
  "version": "0.1.0",
  "identifier": "dev.project.{{appId}}",
  "build": {
    "beforeDevCommand": "pnpm dev:web",
    "devUrl": "http://127.0.0.1:1420",
    "beforeBuildCommand": "pnpm build:web",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "{{appId}}",
        "width": 1100,
        "height": 800
      }
    ],
    "security": {
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/icon.png",
      "icons/icon.ico",
      "icons/icon.icns"
    ]
  }
}
