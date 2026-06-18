# Local Installation Guide

This guide is for someone who does not have a GitHub account and just wants to download the app as a ZIP file, open it with Claude Code, and run it locally.

## What You Need First

Install these before opening the project:

- Node.js LTS: https://nodejs.org/
- Claude Code: https://claude.ai/code

You do not need a GitHub account.

## Download The ZIP From GitHub

1. Open the public GitHub repository link:

   https://github.com/marc12kap/portfolio-review-local

2. Click the green **Code** button.
3. Click **Download ZIP**.
4. Find the downloaded ZIP file, usually in your Downloads folder.
5. Right-click the ZIP file and choose **Extract All** or **Unzip**.
6. Open the extracted folder. It should be named something like `portfolio-review-local-main`.

## Open The Folder In Claude Code

Use whichever method is most natural on your computer.

### Option A: Open From Claude Code

1. Open Claude Code.
2. Start a new conversation or project.
3. Choose the extracted `portfolio-review-local-main` folder as the working folder.
4. Paste the prompt below.

### Option B: Open From A Terminal

On Windows PowerShell:

```powershell
cd "$HOME\Downloads\portfolio-review-local-main"
claude
```

On macOS or Linux:

```bash
cd ~/Downloads/portfolio-review-local-main
claude
```

Then paste the prompt below.

## Prompt To Give Claude Code

```text
Please get this project running locally.

Start by inspecting README.md and package.json so you understand the app. Then install dependencies, build the app, and start the local server. Use the existing project scripts where possible.

Expected commands are probably:

npm install
npm run build
npm start

When it is running, tell me the local URL to open in my browser. If port 8787 is already being used, either stop the old local Node server for this project or start this app on another local port and tell me the new URL.

Please do not edit the portfolio data unless I ask. If anything fails, explain the exact error and fix it if you can.
```

## Expected Local URL

After the server starts, open:

```text
http://127.0.0.1:8787
```

## Editing The Portfolio

The app stores local portfolio data in:

```text
data/positions.csv
data/settings.json
data/performance.csv
```

Those files are local after download. Editing them on your computer does not change anything on GitHub.

Inside the app, use **Edit Positions** to change holdings. Saving writes back to the local `data/positions.csv` and `data/settings.json` files.

## Troubleshooting

If `npm` is not recognized, install Node.js LTS from https://nodejs.org/ and reopen your terminal.

If the app says port `8787` is already in use, ask Claude Code to stop the old local server or run the app on another port:

```powershell
$env:PORT=8788
npm start
```

Then open:

```text
http://127.0.0.1:8788
```
