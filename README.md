# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

Open **http://127.0.0.1:5173/**. Vite refreshes the app as you save changes. Use the same address and browser profile each time to keep your local projects available.

On this loopback development server, the app opens without a sign-in screen. Use Node.js 22.13 or later for the built-in SQLite module. The server creates `data/taqdiri-local.sqlite` inside the repository. It contains local projects, BOQ items, prices, analyses, custom breakdown templates, and project attachments. The configured Cloud client and account access apply to production builds.

For a GitHub code backup, commit the intended source files on a separate branch and push that branch to your backup repository. A push to the Lovable-connected branch syncs to Lovable. The SQLite file and `.env` are ignored by Git. To back up the local project data, stop Vite and copy the SQLite file. To restore it on another machine, place the file at the same path in that checkout before running `npm run dev`.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
