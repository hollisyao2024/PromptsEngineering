{
  "name": "@project/{{appId}}",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.13"
  },
  "scripts": {
    "dev": "node --watch {{sourceDir}}/server.mjs",
    "start": "node {{sourceDir}}/server.mjs",
    "test": "node --test tests/*.test.mjs",
    "build": "node --check {{sourceDir}}/server.mjs"
  }
}
