#!/bin/zsh
# Conductor Setup Script
# Runs automatically when a new workspace is created
#
# Available environment variables:
#   CONDUCTOR_WORKSPACE_NAME  - Workspace name (e.g., "vienna")
#   CONDUCTOR_WORKSPACE_PATH  - Full path to workspace
#   CONDUCTOR_ROOT_PATH       - Path to repository root
#   CONDUCTOR_DEFAULT_BRANCH  - Default branch (usually "main")
#   CONDUCTOR_PORT            - First in range of 10 ports for this workspace
#
# USER PREFERENCES:
#   - Testing: Vercel preview deployments (not local dev server)
#   - Click "Run" deploys to Vercel and returns preview URL
#
# EXTENSIBILITY:
#   - Add custom setup hooks in scripts/hooks/setup.d/*.sh
#   - Add new skills with: ./scripts/conductor-new-skill.sh <name>

set -e  # Exit on error

echo "=== Conductor Setup ==="
echo "Workspace: $CONDUCTOR_WORKSPACE_NAME"
echo "Path: $CONDUCTOR_WORKSPACE_PATH"
echo ""

# 1. Install dependencies
echo "[1/5] Installing dependencies..."
npm install

# 2. Symlink .env file if exists at root
echo "[2/5] Setting up environment..."
if [ -f "$CONDUCTOR_ROOT_PATH/.env" ]; then
    echo "  Symlinking .env from root..."
    ln -sf "$CONDUCTOR_ROOT_PATH/.env" .env
elif [ -f "$CONDUCTOR_ROOT_PATH/.env.local" ]; then
    echo "  Symlinking .env.local from root..."
    ln -sf "$CONDUCTOR_ROOT_PATH/.env.local" .env.local
else
    echo "  No .env file found at root. Create one if needed."
fi

# 3. Initialize .context directory if not present
echo "[3/5] Initializing .context directory..."
if [ ! -d ".context" ]; then
    mkdir -p .context/plans .context/attachments

    cat > .context/notes.md << 'EOF'
# Workspace Notes

## Project Context
<!-- Add project-specific context here -->

## Key Files
<!-- List important files in this workspace -->

## Testing Preference
**Vercel Preview Deployments** - Click "Run" in Conductor to deploy and test on Vercel.
Local development is available via `npm run dev` if needed.

## Dependencies
<!-- Note any dependencies or external services -->
EOF

    cat > .context/todos.md << 'EOF'
# Workspace Todos

## In Progress

## Pending

## Completed
EOF
    echo "  Created notes.md and todos.md"
else
    echo "  .context already exists"
fi

# 4. Verify Vercel CLI (required for testing)
echo "[4/5] Checking Vercel CLI..."
if command -v vercel &> /dev/null; then
    echo "  Vercel CLI: $(vercel --version)"
    if vercel whoami &> /dev/null; then
        echo "  Logged in as: $(vercel whoami)"
    else
        echo "  Warning: Not logged into Vercel. Run 'vercel login'"
    fi
else
    echo "  Warning: Vercel CLI not found. Install with 'npm i -g vercel'"
fi

# 5. Run custom setup hooks (extensibility)
echo "[5/5] Running custom hooks..."
HOOKS_DIR="$CONDUCTOR_WORKSPACE_PATH/scripts/hooks/setup.d"
if [ -d "$HOOKS_DIR" ]; then
    for hook in "$HOOKS_DIR"/*.sh; do
        if [ -f "$hook" ]; then
            echo "  Running: $(basename $hook)"
            source "$hook"
        fi
    done
else
    echo "  No custom hooks (add to scripts/hooks/setup.d/)"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Testing: Click 'Run' in Conductor to deploy to Vercel preview"
echo "Local:   npm run dev (if needed)"
echo "Skills:  ./scripts/conductor-new-skill.sh <name> to add agent skills"
