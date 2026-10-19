# Xirang plugin privacy policy

Effective date: 2026-10-20. Applies to the Xirang / 息壤 plugin from version 0.1.2.

## Summary

The plugin does not collect, transmit, sell, or retain personal data. It has no account, hosted service, telemetry, analytics, MCP server, or hooks. The author receives no data from your use of it.

## What runs locally

- The four skills are instructions for your AI host. They ask the host to run commands in the project you choose, subject to your host and project approval rules.
- `scripts/inspect-project.cjs` reads local project metadata (rule files, entry points, ownership baselines and the Git `origin` URL) and prints a report to the terminal. It writes nothing and sends nothing over the network.

## Network access you may authorize

Project commands started through the skills can contact services you already use:

- GitHub, with the token kept in the project's ignored `.env.local`, for fetches, pushes and pull requests of your own repository.
- The public Xirang template repository on GitHub, fetched anonymously over HTTPS without credentials, when you update the template.

Those requests go directly from your machine to the service and follow that service's privacy policy. The plugin never asks you to paste credentials into a chat and does not store them.

## Your AI host

Conversation content, file contents and command output that your host reads are processed by the host and its model provider under their own terms and privacy policies, not by this plugin.

## Changes and contact

Changes are published in this file and the repository changelog. Questions or reports: [GitHub Issues](https://github.com/hollisyao2024/PromptsEngineering/issues). Do not include tokens or project secrets.
