
# PathMind

PathMind is an AI-powered personalized learning platform designed to help learners understand their current skills, identify knowledge gaps, build personalized learning paths, and practice through AI-powered tools.

## 🚀 Features

- **Personalized Learning Paths** — Generate and follow structured learning plans based on your goals and current skill level.
- **Skill DNA** — Track skills, mastery, and learning progress.
- **Skill Gap Detection** — Identify areas that require further development.
- **AI Tutor** — Get explanations, hints, guidance, and interactive learning support.
- **AI Interview** — Practice technical, behavioral, and mixed interviews.
- **Calibration** — Assess your current knowledge and establish a learning baseline.
- **Learning Progress** — Track development across different skills and learning objectives.
- **Authentication** — Secure user authentication and personalized learner data.

## 🏗️ Architecture

PathMind is a full-stack application.

```text
PathMind
│
├── Frontend
│   ├── React
│   ├── TypeScript
│   ├── TanStack Start
│   └── Tailwind CSS
│
├── Server
│   ├── TanStack Start Server Functions
│   ├── AI integrations
│   ├── Authentication logic
│   └── Application business logic
│
└── Database
    └── Supabase / PostgreSQL
        ├── Authentication
        ├── Application data
        └── Database migrations
````

## 🛠️ Tech Stack

* React
* TypeScript
* TanStack Start
* Tailwind CSS
* Supabase
* PostgreSQL
* Vite
* Gemini API

## 📁 Project Structure

```text
PathMind-Learner/
│
├── public/
│   └── Static assets
│
├── scripts/
│   └── Project scripts
│
├── src/
│   ├── components/
│   │   └── Reusable UI components
│   │
│   ├── hooks/
│   │   └── React hooks
│   │
│   ├── integrations/
│   │   └── External integrations
│   │
│   ├── lib/
│   │   └── Application and server logic
│   │
│   └── routes/
│       └── Application routes
│
├── supabase/
│   ├── migrations/
│   │   └── Database migrations
│   └── config.toml
│
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 💻 Local Development

### Prerequisites

Make sure you have installed:

* Node.js
* npm
* Git

### 1. Clone the repository

```bash
git clone https://github.com/kasya2212/PathMind-Learner.git
```

### 2. Enter the project directory

```bash
cd PathMind-Learner
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

Create a `.env` file in the project root.

Add the required environment variables for the application.

Example:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
GEMINI_API_KEY=
```

Do not commit your `.env` file or any private API keys to GitHub.

### 5. Start the development server

```bash
npm run dev
```

The terminal will display the local development URL.

Open that URL in your browser.

## 🔐 Environment Variables

PathMind uses environment variables for external services and private configuration.

Typical configuration includes:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
GEMINI_API_KEY=
```

The exact variables required by the current implementation should be checked against the project's server-side configuration.

Never commit real credentials or API keys to the repository.

## 🗄️ Database

The project includes Supabase database migrations under:

```text
supabase/migrations/
```

These migrations define the database structure required by the application.

The database, authentication users, and stored application data are managed separately from the source code.

## 🤖 AI Features

### AI Tutor

The AI Tutor provides personalized learning assistance including:

* Explanations
* Hints
* Learning guidance
* Questions
* Interactive practice

### AI Interview

The AI Interview feature provides mock interview experiences including:

* Technical interviews
* Behavioral interviews
* Mixed interviews
* Different difficulty levels

## 🔒 Security

Private credentials should never be committed to the repository.

Do not commit:

```text
.env
.env.local
API keys
Private tokens
Database passwords
```

Use environment variables for sensitive configuration.

## 📌 Project Status

PathMind is under active development.

The application includes personalized learning, Skill DNA, learning plans, skill-gap detection, calibration, AI interview functionality, and other learner-focused features.

Some AI-powered functionality requires external API configuration to operate locally.

## 👨‍💻 Development

Create a feature branch:

```bash
git checkout -b feature/your-feature
```

Make your changes and test them locally.

Then commit:

```bash
git add .
git commit -m "Describe your changes"
```

Push the branch:

```bash
git push origin feature/your-feature
```

## 📄 License

This project is currently maintained as a private repository.

````

After replacing the README, save it and run:

```powershell
git add README.md
git commit -m "Update project documentation"
git push
````



