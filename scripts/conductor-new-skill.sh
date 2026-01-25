#!/bin/zsh
# Conductor Skills Manager
# Create, list, and build agent skills following Supabase/Vercel patterns
#
# Commands:
#   ./scripts/conductor-new-skill.sh create <name> [description]  - Create new skill
#   ./scripts/conductor-new-skill.sh list                         - List all skills
#   ./scripts/conductor-new-skill.sh build [skill-name]           - Build AGENTS.md
#   ./scripts/conductor-new-skill.sh <name> [description]         - Shorthand for create
#
# Examples:
#   ./scripts/conductor-new-skill.sh react-best-practices "Performance optimization"
#   ./scripts/conductor-new-skill.sh list
#   ./scripts/conductor-new-skill.sh build react-best-practices
#
# Skills Registry: skills/skills.json (auto-managed)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SKILLS_DIR="$PROJECT_ROOT/skills"
REGISTRY_FILE="$SKILLS_DIR/skills.json"

# Initialize skills directory and registry if needed
init_registry() {
    mkdir -p "$SKILLS_DIR"
    if [ ! -f "$REGISTRY_FILE" ]; then
        echo '{"skills": [], "lastUpdated": ""}' > "$REGISTRY_FILE"
    fi
}

# Add skill to registry
add_to_registry() {
    local name="$1"
    local desc="$2"
    local date=$(date +%Y-%m-%d)

    # Use node/jq to update JSON, fallback to simple append
    if command -v node &> /dev/null; then
        node -e "
            const fs = require('fs');
            const reg = JSON.parse(fs.readFileSync('$REGISTRY_FILE'));
            if (!reg.skills.find(s => s.name === '$name')) {
                reg.skills.push({name: '$name', description: '$desc', created: '$date'});
                reg.lastUpdated = '$date';
                fs.writeFileSync('$REGISTRY_FILE', JSON.stringify(reg, null, 2));
            }
        "
    fi
}

# List all skills
list_skills() {
    echo "=== Registered Skills ==="
    echo ""

    if [ -f "$REGISTRY_FILE" ] && command -v node &> /dev/null; then
        node -e "
            const fs = require('fs');
            const reg = JSON.parse(fs.readFileSync('$REGISTRY_FILE'));
            if (reg.skills.length === 0) {
                console.log('  No skills registered yet.');
                console.log('  Create one with: ./scripts/conductor-new-skill.sh <name>');
            } else {
                reg.skills.forEach((s, i) => {
                    console.log(\`  \${i+1}. \${s.name}\`);
                    console.log(\`     \${s.description}\`);
                    console.log(\`     Created: \${s.created}\`);
                    console.log('');
                });
            }
        "
    else
        # Fallback: list directories
        if [ -d "$SKILLS_DIR" ]; then
            for skill_dir in "$SKILLS_DIR"/*/; do
                if [ -d "$skill_dir" ]; then
                    skill_name=$(basename "$skill_dir")
                    if [ "$skill_name" != "skills.json" ]; then
                        echo "  - $skill_name"
                    fi
                fi
            done
        else
            echo "  No skills directory found."
        fi
    fi
}

# Build AGENTS.md from rules
build_skill() {
    local skill_name="$1"
    local skill_path="$SKILLS_DIR/$skill_name"

    if [ ! -d "$skill_path" ]; then
        echo "Error: Skill '$skill_name' not found at $skill_path"
        exit 1
    fi

    echo "=== Building: $skill_name ==="

    local output_file="$skill_path/AGENTS.md"
    local rules_dir="$skill_path/rules"
    local date=$(date +%Y-%m-%d)

    # Read metadata
    local version="1.0.0"
    local abstract=""
    if [ -f "$skill_path/metadata.json" ] && command -v node &> /dev/null; then
        version=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$skill_path/metadata.json')).version || '1.0.0')")
        abstract=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$skill_path/metadata.json')).abstract || '')")
    fi

    # Generate AGENTS.md header
    cat > "$output_file" << EOF
# ${skill_name//-/ } - Agent Guidelines

> Version: $version | Generated: $date

$abstract

---

## Rules

EOF

    # Compile rules (excluding underscore-prefixed files)
    local rule_count=0
    for rule_file in "$rules_dir"/*.md; do
        if [ -f "$rule_file" ]; then
            local basename=$(basename "$rule_file")
            # Skip underscore-prefixed files
            if [[ "$basename" != _* ]]; then
                echo "  Processing: $basename"
                echo "### $(basename "$rule_file" .md)" >> "$output_file"
                echo "" >> "$output_file"
                cat "$rule_file" >> "$output_file"
                echo "" >> "$output_file"
                echo "---" >> "$output_file"
                echo "" >> "$output_file"
                ((rule_count++))
            fi
        fi
    done

    echo ""
    echo "Built: $output_file ($rule_count rules)"
}

# Create new skill
create_skill() {
    local skill_name="$1"
    local skill_desc="${2:-A collection of best practices and guidelines}"

    if [ -z "$skill_name" ]; then
        echo "Usage: $0 create <skill-name> [description]"
        echo "Example: $0 create react-best-practices \"Performance optimization for React apps\""
        exit 1
    fi

    init_registry

    local skill_path="$SKILLS_DIR/$skill_name"
    local date=$(date +%Y-%m-%d)
    local author_name="${AUTHOR_NAME:-$(git config user.name 2>/dev/null || echo 'Unknown')}"

    if [ -d "$skill_path" ]; then
        echo "Error: Skill '$skill_name' already exists at $skill_path"
        exit 1
    fi

    echo "=== Creating Skill: $skill_name ==="
    echo "Path: $skill_path"
    echo ""

    # Create directory structure
    mkdir -p "$skill_path/rules"

    # Create metadata.json
    cat > "$skill_path/metadata.json" << EOF
{
  "version": "1.0.0",
  "organization": {
    "name": "$author_name",
    "url": ""
  },
  "abstract": "$skill_desc",
  "lastUpdated": "$date",
  "license": "MIT",
  "keywords": [],
  "categories": []
}
EOF

    # Create _sections.md
    cat > "$skill_path/rules/_sections.md" << 'EOF'
# Sections

Define rule categories and their impact levels.

Format: `## {Number}. {Section Title} ({Impact Level})`
The prefix is used for rule file naming: `{prefix}-rule-name.md`

---

## 1. Critical Performance (Critical)
prefix: perf-
description: Rules with significant performance impact. Must be followed.

## 2. Architecture Patterns (High)
prefix: arch-
description: Structural patterns affecting maintainability and scalability.

## 3. Code Quality (Medium)
prefix: quality-
description: Best practices for code readability and maintainability.

## 4. Developer Experience (Low)
prefix: dx-
description: Recommendations that improve developer workflow.

---

## Impact Level Definitions

| Level | Description |
|-------|-------------|
| Critical | Must follow. Violations cause bugs, security issues, or performance problems |
| High | Strongly recommended. Violations lead to technical debt |
| Medium | Recommended. Improves code quality and consistency |
| Low | Nice to have. Optimizations and enhancements |
EOF

    # Create _template.md
    cat > "$skill_path/rules/_template.md" << 'EOF'
---
title: "Rule Title Here"
impact: High
tags: [tag1, tag2]
---

## Explanation

Clear explanation of the rule (minimum 50 characters).

## Why This Matters

Describe the impact of following or not following this rule.

## Examples

### Bad (Wrong)

```typescript
// This approach has problems because...
function badExample() {
  // Inefficient or incorrect implementation
}
```

### Good (Correct)

```typescript
// This is the recommended approach
function goodExample() {
  // Efficient and correct implementation
}
```

## References

- [Reference 1](https://example.com)
EOF

    # Create SKILL.md
    cat > "$skill_path/SKILL.md" << EOF
---
name: $skill_name
description: $skill_desc
license: MIT
---

# ${skill_name//-/ }

$skill_desc

## When to Use

Use this skill when:
- Working on related tasks
- Implementing new features
- Reviewing code

## Categories

See \`rules/_sections.md\` for category definitions.

## Building

Compile rules into AGENTS.md:

\`\`\`bash
./scripts/conductor-new-skill.sh build $skill_name
\`\`\`

## Contributing

1. Create rule file in \`rules/\` using \`_template.md\` pattern
2. Follow naming convention: \`{section-prefix}-{rule-name}.md\`
3. Include required frontmatter: \`title\`, \`impact\`, \`tags\`
4. Provide both good and bad examples
EOF

    # Create example rule
    cat > "$skill_path/rules/quality-example-rule.md" << 'EOF'
---
title: "Example Rule"
impact: Medium
tags: [example, template]
---

## Explanation

This is an example rule demonstrating the proper structure. Replace this with your actual rule content. Make sure explanations are clear and actionable.

## Why This Matters

Example rules help new contributors understand the expected format. Following a consistent structure makes rules easier to read and maintain.

## Examples

### Bad (Wrong)

```typescript
// Unclear, no comments, magic numbers
function process(x) {
  return x * 1.1 + 5;
}
```

**Why it's wrong:** No documentation, unclear purpose, magic numbers.

### Good (Correct)

```typescript
// Apply tax rate and handling fee to price
const TAX_RATE = 0.1;
const HANDLING_FEE = 5;

function calculateTotal(price: number): number {
  return price * (1 + TAX_RATE) + HANDLING_FEE;
}
```

**Why it's right:** Clear naming, documented constants, typed parameters.

## References

- [Agent Skills Format](https://github.com/supabase/agent-skills)
- [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills)
EOF

    # Add to registry
    add_to_registry "$skill_name" "$skill_desc"

    echo "=== Skill Created ==="
    echo ""
    echo "Files created:"
    echo "  $skill_path/metadata.json"
    echo "  $skill_path/SKILL.md"
    echo "  $skill_path/rules/_sections.md"
    echo "  $skill_path/rules/_template.md"
    echo "  $skill_path/rules/quality-example-rule.md"
    echo ""
    echo "Next steps:"
    echo "  1. Edit rules/_sections.md to define your categories"
    echo "  2. Create rule files using _template.md as a guide"
    echo "  3. Build with: ./scripts/conductor-new-skill.sh build $skill_name"
}

# Main command router
case "${1:-}" in
    list)
        list_skills
        ;;
    build)
        if [ -z "$2" ]; then
            echo "Usage: $0 build <skill-name>"
            echo "Example: $0 build react-best-practices"
            exit 1
        fi
        build_skill "$2"
        ;;
    create)
        create_skill "$2" "$3"
        ;;
    -h|--help|help)
        echo "Conductor Skills Manager"
        echo ""
        echo "Commands:"
        echo "  $0 <name> [desc]       Create new skill (shorthand)"
        echo "  $0 create <name> [desc] Create new skill"
        echo "  $0 list                 List all skills"
        echo "  $0 build <name>         Build AGENTS.md from rules"
        echo "  $0 help                 Show this help"
        echo ""
        echo "Examples:"
        echo "  $0 react-best-practices \"Performance optimization\""
        echo "  $0 list"
        echo "  $0 build react-best-practices"
        ;;
    "")
        echo "Usage: $0 <command> [args]"
        echo "Run '$0 help' for available commands"
        exit 1
        ;;
    *)
        # Default: treat as create command for backwards compatibility
        create_skill "$1" "$2"
        ;;
esac
