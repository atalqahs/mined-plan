# Vendored Claude Code skills

Project-local agent skills used while building ORBITAL MIND. They are plain
Markdown instruction files (no executable install scripts were run).

| Skill folder | Source | Commit | License |
|---|---|---|---|
| `frontend-design` | github.com/anthropics/skills (skills/frontend-design) | e4bb5d9 | Apache-2.0 (`frontend-design/LICENSE.txt`) |
| `react-best-practices` | github.com/vercel-labs/agent-skills (skills/react-best-practices) | 1a2c79d | MIT (declared in SKILL.md) |
| `threejs-*` (r3f, performance, interaction, lighting, materials, geometry, animation, scene, shaders) | github.com/cesartevisual/threejs-skills | 84f9bcb | MIT (`THREEJS-SKILLS-LICENSE.txt`) |

**UI UX Pro Max** (github.com/nextlevelbuilder/ui-ux-pro-max-skill) was already
available in the build environment as a synced skill, so it was used from there
rather than re-installed with `npx ui-ux-pro-max-cli init`.

Equivalent upstream install commands:

```bash
npx skills add anthropics/skills --skill frontend-design --agent claude-code
npx skills add vercel-labs/agent-skills --skill react-best-practices --agent claude-code
npx skills add cesartevisual/threejs-skills --skill threejs-r3f --agent claude-code
npx ui-ux-pro-max-cli init --ai claude
```
