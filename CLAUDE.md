# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React-based fluency training application that helps users improve their spoken fluency by practicing word retrieval from definitions. The app simulates "tip of the tongue" moments by presenting definitions and asking users to recall the corresponding words.

## Commands

### Development
- `npm run dev` - Start the development server (runs on http://localhost:5173)
- `npm run build` - Build for production
- `npm run build-dev` - Build for development
- `npm run build-uat` - Build for UAT environment
- `npm run build-prod` - Build for production
- `npm run preview` - Preview the production build locally

### Code Quality
- `npm run lint` - Run ESLint with React-specific rules

### Deployment
- `npm run deploy` - Build and deploy to GitHub Pages using gh-pages
- `npm run gh-pages` - Build for production with GitHub Pages base path and copy to docs directory

## Architecture

### Core Components
- **App.jsx**: Main app wrapper with basic layout
- **ZipfTrainer.jsx**: Main training component containing all functionality including:
  - Word selection based on Zipf frequency scores
  - Adaptive difficulty adjustment
  - Parts of speech filtering
  - Settings management with localStorage persistence
  - API integration with Dictionary API

### Key Features
- **Adaptive Difficulty**: Uses Zipf frequency scores (1-8 scale) to adjust word difficulty
- **Parts of Speech Filtering**: Users can select which parts of speech to practice (noun, verb, adjective, adverb)
- **Display Preferences**: Toggle showing examples and synonyms
- **Local Storage**: Persists user preferences, difficulty levels, and active parts of speech

### Data Structure
- **Word Frequency Data**: Located at `/public/data/en_frequencies.json`
  - Contains words with `raw_frequency` and `zipf` scores
  - Zipf scores range from ~1 (rare) to ~8 (common)
- **Dictionary API**: Uses https://api.dictionaryapi.dev/api/v2/entries/en/{word}

### Build Configuration
- **Vite**: Build tool with React SWC plugin
- **Tailwind CSS**: Utility-first CSS framework
- **Dual Output**: Builds to both `dist/` and `docs/` directories
- **GitHub Pages**: Deployed with base path `/Fluency-Trainer/`

### State Management
- Local component state with React hooks
- localStorage for persistence
- Adaptive difficulty using Zipf score adjustments (±0.05 per feedback)
- Word selection within ±0.1 Zipf score range

## File Structure Notes
- `src/components/ZipfTrainer.jsx` is the main component (380+ lines)
- Word data is loaded from `/public/data/en_frequencies.json`
- Build outputs to `docs/` directory for GitHub Pages deployment
- Production builds use `/Fluency-Trainer/` as base path

## Development Notes
- Uses modern React patterns (hooks, functional components)
- ESLint configured with React-specific rules
- No TypeScript - uses plain JavaScript with JSX
- Tailwind CSS for styling with utility classes
- External API dependency for word definitions