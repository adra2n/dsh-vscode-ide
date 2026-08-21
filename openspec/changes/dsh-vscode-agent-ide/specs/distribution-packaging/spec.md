## ADDED Requirements

### Requirement: Build standalone desktop app
The product SHALL build as a standalone desktop application for macOS, Windows, and Linux from the Code - OSS fork, installable without a pre-existing VSCode.

#### Scenario: Install on a clean machine
- **WHEN** a user installs the packaged app on a machine without VSCode
- **THEN** the IDE launches as a self-contained application

### Requirement: Independent branding and licensing
The product SHALL use its own name, icon, and branding, strip Microsoft services and telemetry, and retain MIT and third-party license notices.

#### Scenario: No VS Code trademark
- **WHEN** the app is built and distributed
- **THEN** it does not present itself as "Visual Studio Code" and retains all required license notices

### Requirement: Self-hostable model default
The product SHALL default to open or self-hostable model endpoints (e.g., DeepSeek, Ollama / vLLM via OpenAI-compatible API) and allow custom base URL configuration, avoiding binding to commercial AI SaaS.

#### Scenario: Configure self-hosted model
- **WHEN** a user sets a custom OpenAI-compatible base URL and model
- **THEN** the agent uses that endpoint without any commercial SaaS dependency
