#!/usr/bin/env node
/**
 * Trickcal Deploy Manager
 * Interactive CLI for Git operations and deployment
 */

const { execSync } = require('child_process');
const readline = require('readline');
const ghpages = require('gh-pages');
const path = require('path');
const fs = require('fs');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Color output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function execCommand(command, silent = false) {
  try {
    const result = execSync(command, { 
      encoding: 'utf8',
      stdio: silent ? 'pipe' : 'inherit'
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(`${colors.cyan}${prompt}${colors.reset}`, resolve);
  });
}

async function showMenu() {
  console.clear();
  log('\n╔════════════════════════════════════════════╗', 'bright');
  log('║     🚀 Trickcal Deploy Manager v1.0      ║', 'bright');
  log('╚════════════════════════════════════════════╝\n', 'bright');
  
  log('Select an option:\n', 'yellow');
  log('  1. 📊 View current status', 'cyan');
  log('  2. ➕ Stage & commit changes', 'cyan');
  log('  3. 🚀 Push to GitHub', 'cyan');
  log('  4. 🔨 Build project (production)', 'cyan');
  log('  5. 🚀 Publish to GitHub Pages', 'cyan');
  log('  6. 🎯 Quick deploy (build + publish)', 'green');
  log('  7. 📜 View commit history', 'cyan');
  log('  8. ↩️  Undo last commit', 'yellow');
  log('  9. 🗑️  Delete remote branch', 'red');
  log(' 10. ℹ️  Show help', 'cyan');
  log('  0. 👋 Exit\n', 'magenta');
  
  const choice = await question('Enter option (0-10): ');
  return choice.trim();
}

async function showStatus() {
  log('\n📊 Git status:\n', 'bright');
  execCommand('git status --short');
  log('\n📌 Current branch:', 'bright');
  execCommand('git branch --show-current');
  await question('\nPress Enter to continue...');
}

async function commitChanges() {
  log('\n➕ Stage & commit changes\n', 'bright');
  
  log('📝 Current changes:\n', 'yellow');
  execCommand('git status --short');
  
  const addAll = await question('\nStage all changes? (Y/n): ');
  if (addAll.toLowerCase() !== 'n') {
    log('\n📦 Staging all changes...', 'cyan');
    const result = execCommand('git add -A', true);
    if (result.success) {
      log('✅ All changes staged', 'green');
    } else {
      log('❌ Stage failed', 'red');
      await question('\nPress Enter to continue...');
      return;
    }
  }
  
  const message = await question('\n💬 Enter commit message: ');
  if (!message.trim()) {
    log('❌ Commit message cannot be empty', 'red');
    await question('\nPress Enter to continue...');
    return;
  }
  
  log('\n📝 Committing...', 'cyan');
  const result = execCommand(`git commit -m "${message}"`, true);
  
  if (result.success) {
    log('✅ Commit successful!', 'green');
  } else {
    log('❌ Commit failed', 'red');
  }
  
  await question('\nPress Enter to continue...');
}

async function pushToGitHub() {
  log('\n🚀 Push to GitHub\n', 'bright');
  
  const branch = execCommand('git branch --show-current', true).output.trim();
  log(`📌 Current branch: ${branch}\n`, 'yellow');
  
  const confirm = await question(`Push to origin/${branch}? (Y/n): `);
  if (confirm.toLowerCase() === 'n') {
    log('❌ Push cancelled', 'yellow');
    await question('\nPress Enter to continue...');
    return;
  }
  
  log('\n🚀 Pushing...', 'cyan');
  const result = execCommand(`git push origin ${branch}`);
  
  if (result.success) {
    log('\n✅ Push successful!', 'green');
    log('💡 To deploy to GitHub Pages, use option 5 or 6\n', 'cyan');
  } else {
    log('\n❌ Push failed', 'red');
  }
  
  await question('\nPress Enter to continue...');
}

async function buildProject() {
  log('\n🔨 Build project (production)\n', 'bright');
  log('📄 Loading env vars from .env\n', 'yellow');
  
  const confirm = await question('Start build? This may take a few seconds (Y/n): ');
  if (confirm.toLowerCase() === 'n') {
    log('❌ Build cancelled', 'yellow');
    await question('\nPress Enter to continue...');
    return;
  }
  
  log('\n🔨 Building...', 'cyan');
  const origTarget = process.env.VITE_DEPLOY_TARGET;
  process.env.VITE_DEPLOY_TARGET = 'gh-pages';
  const result = execCommand('pnpm run build');
  if (origTarget !== undefined) {
    process.env.VITE_DEPLOY_TARGET = origTarget;
  } else {
    delete process.env.VITE_DEPLOY_TARGET;
  }
  
  if (result.success) {
    log('\n✅ Build successful!', 'green');
  } else {
    log('\n❌ Build failed', 'red');
  }
  
  await question('\nPress Enter to continue...');
}

async function quickDeploy() {
  log('\n🎯 Quick deploy\n', 'bright');
  log('This will execute:', 'yellow');
  log('  1. Build project (production)', 'cyan');
  log('  2. Publish to GitHub Pages\n', 'cyan');
  
  const confirm = await question('Start quick deploy? (Y/n): ');
  if (confirm.toLowerCase() === 'n') {
    log('❌ Deploy cancelled', 'yellow');
    await question('\nPress Enter to continue...');
    return;
  }
  
  // Step 1: Build
  log('\n🔨 [1/2] Building project...', 'cyan');
  const origTarget = process.env.VITE_DEPLOY_TARGET;
  process.env.VITE_DEPLOY_TARGET = 'gh-pages';
  let result = execCommand('pnpm run build');
  if (origTarget !== undefined) {
    process.env.VITE_DEPLOY_TARGET = origTarget;
  } else {
    delete process.env.VITE_DEPLOY_TARGET;
  }
  if (!result.success) {
    log('❌ Build failed, deploy aborted', 'red');
    await question('\nPress Enter to continue...');
    return;
  }
  log('✅ Build complete', 'green');
  
  // Step 2: Publish to gh-pages
  log('\n📤 [2/2] Publishing to GitHub Pages...', 'cyan');
  const distPath = path.resolve(__dirname, '../dist');
  const remoteUrl = execCommand('git remote get-url origin', true).output.trim();
  
  const publishResult = await new Promise((resolve) => {
    ghpages.publish(distPath, {
      branch: 'gh-pages',
      repo: remoteUrl,
      message: `deploy: update ${new Date().toISOString().split('T')[0]}`,
      dotfiles: true,
    }, (err) => {
      if (err) {
        log(`\n❌ Publish failed: ${err.message}`, 'red');
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
  
  if (publishResult) {
    log('\n🎉 Quick deploy complete!', 'green');
    log('🌐 https://OrkunKocyigit.github.io/trickcal-tools/\n', 'blue');
  }
  
  await question('\nPress Enter to continue...');
}

async function showHistory() {
  log('\n📜 Last 10 commits:\n', 'bright');
  execCommand('git log --oneline --graph --decorate -10');
  await question('\nPress Enter to continue...');
}

async function undoLastCommit() {
  log('\n↩️  Undo last commit\n', 'bright');
  
  log('⚠️  This will undo the last commit but keep changes', 'yellow');
  log('💡 Changes return to staging, ready to recommit\n', 'cyan');
  
  const confirm = await question('Undo last commit? (y/N): ');
  if (confirm.toLowerCase() !== 'y') {
    log('❌ Operation cancelled', 'yellow');
    await question('\nPress Enter to continue...');
    return;
  }
  
  log('\n↩️  Undoing...', 'cyan');
  const result = execCommand('git reset --soft HEAD~1', true);
  
  if (result.success) {
    log('✅ Last commit undone', 'green');
    log('📝 Changes retained in staging', 'cyan');
  } else {
    log('❌ Undo failed', 'red');
  }
  
  await question('\nPress Enter to continue...');
}

async function deleteBranch() {
  log('\n🗑️  Delete remote branch\n', 'bright');
  
  log('⚠️  WARNING: This is destructive!', 'red');
  log('💡 Make sure you know what you are doing\n', 'yellow');
  
  const branchName = await question('Enter remote branch name to delete: ');
  if (!branchName.trim()) {
    log('❌ Branch name cannot be empty', 'red');
    await question('\nPress Enter to continue...');
    return;
  }
  
  const confirm = await question(`\n⚠️  Delete remote branch "${branchName}"? (y/N): `);
  if (confirm.toLowerCase() !== 'y') {
    log('❌ Delete cancelled', 'yellow');
    await question('\nPress Enter to continue...');
    return;
  }
  
  log('\n🗑️  Deleting...', 'cyan');
  const result = execCommand(`git push origin --delete ${branchName}`);
  
  if (result.success) {
    log(`\n✅ Remote branch "${branchName}" deleted`, 'green');
  } else {
    log('❌ Delete failed', 'red');
  }
  
  await question('\nPress Enter to continue...');
}

async function publishToGhPages() {
  log('\n🚀 Publish to GitHub Pages\n', 'bright');

  const distPath = path.resolve(__dirname, '../dist');
  if (!fs.existsSync(distPath)) {
    log('❌ dist directory not found, build first', 'red');
    return;
  }

  const remoteUrl = execCommand('git remote get-url origin', true).output.trim();
  if (!remoteUrl) {
    log('❌ Could not get remote repo URL', 'red');
    return;
  }

  log(`📡 Remote repo: ${remoteUrl}\n`, 'yellow');

  const confirm = await question('Publish to GitHub Pages? (Y/n): ');
  if (confirm.toLowerCase() === 'n') {
    log('❌ Publish cancelled', 'yellow');
    return;
  }

  log('\n📤 Publishing to gh-pages branch...', 'cyan');

  return new Promise((resolve) => {
    ghpages.publish(distPath, {
      branch: 'gh-pages',
      repo: remoteUrl,
      message: `deploy: update ${new Date().toISOString().split('T')[0]}`,
      dotfiles: true,
    }, (err) => {
      if (err) {
        log(`\n❌ Publish failed: ${err.message}`, 'red');
        resolve(false);
      } else {
        log('\n✅ Publish successful!', 'green');
        log('🌐 https://OrkunKocyigit.github.io/trickcal-tools/\n', 'blue');
        resolve(true);
      }
    });
  });
}

async function showHelp() {
  console.clear();
  log('\n╔════════════════════════════════════════════╗', 'bright');
  log('║              📖 Help                       ║', 'bright');
  log('╚════════════════════════════════════════════╝\n', 'bright');
  
  log('Quick start:', 'yellow');
  log('  1. Select "6" for one-click build + deploy\n', 'cyan');
  
  log('Common tasks:', 'yellow');
  log('  • After changing code, deploy:', 'cyan');
  log('    Select 6 → one-click build & deploy to Pages\n', 'green');
  
  log('  • Just check status:', 'cyan');
  log('    Select 1 → view current changes\n', 'green');
  
  log('  • Step by step:', 'cyan');
  log('    Select 4 (build) → 5 (publish to Pages)\n', 'green');
  
  log('Notes:', 'yellow');
  log('  • Review changes before committing', 'cyan');
  log('  • Build before publishing to Pages', 'cyan');
  log('  • Ensure .env has VITE_GOOGLE_CLIENT_ID', 'cyan');
  log('  • Destructive actions require confirmation\n', 'cyan');
  
  log('Tips:', 'yellow');
  log('  • Use emoji prefixes in commit messages', 'cyan');
  log('    🎨 UI  ✨ Feature  🐛 Fix  📝 Docs', 'cyan');
  log('  • Press Ctrl+C to exit anytime\n', 'cyan');
  
  log('Links:', 'yellow');
  log('  • Site: https://OrkunKocyigit.github.io/trickcal-tools/', 'blue');
  
  await question('Press Enter to return to menu...');
}

async function main() {
  while (true) {
    const choice = await showMenu();
    
    switch (choice) {
      case '1':
        await showStatus();
        break;
      case '2':
        await commitChanges();
        break;
      case '3':
        await pushToGitHub();
        break;
      case '4':
        await buildProject();
        break;
      case '5':
        await publishToGhPages();
        break;
      case '6':
        await quickDeploy();
        break;
      case '7':
        await showHistory();
        break;
      case '8':
        await undoLastCommit();
        break;
      case '9':
        await deleteBranch();
        break;
      case '10':
        await showHelp();
        break;
      case '0':
        log('\n👋 Goodbye!', 'green');
        rl.close();
        process.exit(0);
        break;
      default:
        log('\n❌ Invalid option, try again', 'red');
        await question('Press Enter to continue...');
    }
  }
}

// Startup
log('\n🚀 Starting Trickcal Deploy Manager...', 'cyan');
setTimeout(() => {
  main().catch(error => {
    log(`\n❌ Error: ${error.message}`, 'red');
    rl.close();
    process.exit(1);
  });
}, 500);
