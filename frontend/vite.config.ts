import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const chapterRoutes = [
  'lab', 'research', 'methods', 'systems', 'publications', 'observatory', 'notes', 'applied-research',
  // Transitional aliases keep already-shared beta links alive.
  'about', 'method', 'papers', 'products', 'pricing',
]

const staticFallback: Record<string, string> = {
  home: '<p>Emergent Interaction Lab</p><h1>Complex systems, behavior, interaction and emergence.</h1><p>Independent research lab investigating how complex systems behave, interact and change when isolated outputs or formal descriptions are insufficient.</p><h2>Objects of Study</h2><p>AI and agentic systems · Human–Machine Systems · Software and Digital Systems · Organizations and Processes · Complex Evidence Environments · Socio-Technical Systems</p><h2>Analytical Perspectives</h2><p>HMI · Behavioral Analysis · Agentic Systems · Reconstruction · Evidence Architecture · Adversarial Systems Thinking</p><h2>Research Environment</h2><p>315 specialized research agents, a Research Knowledge Graph, the EIL World Model and Observatory support long-running investigations.</p>',
  lab: '<p>Institution</p><h1>Emergent Interaction Lab</h1><p>Independent founder-led research lab for complex dynamic systems.</p><h2>Mission</h2><p>Turning observable traces into defensible representations of system structure, states and change.</p><h2>Why these fields meet here</h2><p>Different systems expose recurring analytical problems: states, roles and change cannot be read from a single output.</p><h2>Research Lineage</h2><p>Human analytical practice and recurring research requirements → repeated analytical operations → methods and protocols → specialized research roles → computational research infrastructure → persistent research state → longitudinal observation.</p><h2>Research Principles</h2><p>Evidence before narrative. Observation is not explanation. Unknowns remain explicit. Prediction is not certainty.</p>',
  research: '<p>Research</p><h1>Research programs</h1><p>Research Domains organize the field; programs group connected concrete research questions. Domains do not require a one-to-one active program mapping.</p><h2>Domains</h2><p>Complex Systems and Emergence · Human–AI Dynamics · Behavioral Intelligence · System Reconstruction · Prediction and Causality · System Integrity · Computational Research Systems</p><h2>Open research questions</h2><p>How do systems change through repeated interaction? What structure can be reconstructed from fragmented evidence? When does drift become structural change?</p>',
  methods: '<p>Public methodology</p><h1>EIL Research Cycle</h1><p>Observe → Attribute → Separate → Contextualize → Reconstruct → Challenge → Model → Validate. Simplified public research logic; not an implementation specification.</p><h2>Evidence Architecture</h2><p>Observed · Reported · Derived · Inferred · Hypothesized · Unknown, with provenance for source, time, context and transformation.</p><h2>Capabilities</h2><p>HMI analysis · Adversarial Systems Thinking · System Reconstruction · Behavioral Analysis · Longitudinal Validation.</p>',
  systems: '<p>Computational research</p><h1>Systems and infrastructure</h1><p>Research infrastructure exists to make long-running, multi-perspective investigation inspectable.</p><h2>Systems</h2><p>Multi-Agent Research Environment · Research Knowledge Graph · EIL World Model · Jarvis · Call Laura · Observatory.</p><h2>Agent environment</h2><p>315 individually authored specialized Rust crates are invoked by an orchestrator for bounded research functions. They are not 315 votes; agreement does not replace evidence.</p>',
  publications: '<p>Research outputs</p><h1>Publications</h1><p>Research outputs are listed with authorship, version, status and peer-review status. Repository release or DOI does not imply peer review.</p>',
  observatory: '<p>Research instrument</p><h1>Observatory</h1><p>A longitudinal instrument for interaction patterns, semantic drift, role stability, state transitions, contradictions and context accumulation.</p><h2>Observation is not explanation</h2><p>The Observatory makes signals and evidence coverage visible; it does not turn correlation into causality or infer intention from behavioral traces.</p>',
  'applied-research': '<p>Applied research</p><h1>Applied Research</h1><p>Selected EIL capabilities can be applied to bounded external investigations with explicit evidence limits and output artifacts.</p><h2>Engagement levels</h2><p>ASSESS · INVESTIGATE · BUILD · MONITOR. Capabilities and commercial packages are separate categories.</p>',
  notes: '<p>Public research communication</p><h1>Research Notes</h1><p>Observations, method notes, experiment notes and research updates are published with explicit status and limitations.</p>',
}

export default defineConfig({
  plugins: [react(), {
    name: 'static-chapter-pages',
    closeBundle() {
      const dist = resolve(__dirname, 'dist')
      // closeBundle can be invoked more than once by tooling; always start from
      // a clean root so a previous home fallback cannot bleed into every route.
      const template = readFileSync(resolve(dist, 'index.html'), 'utf8')
        .replace(/<div id="root">[\s\S]*?<\/div>/, '<div id="root"></div>')
      for (const [route, body] of Object.entries(staticFallback)) {
        const html = template.replace('<div id="root"></div>', `<div id="root"><main class="eil-static-fallback">${body}</main></div>`)
        if (route === 'home') writeFileSync(resolve(dist, 'index.html'), html)
        const target = resolve(dist, route)
        mkdirSync(target, { recursive: true })
        writeFileSync(resolve(target, 'index.html'), html)
      }
      for (const route of chapterRoutes) {
        const target = resolve(dist, route)
        mkdirSync(target, { recursive: true })
        if (!staticFallback[route]) copyFileSync(resolve(dist, 'index.html'), resolve(target, 'index.html'))
      }
    },
  }],
  // GitHub Pages serves this project below its repository path. Keeping the
  // repository base as the default also makes favicon and asset URLs resolve
  // correctly for fresh browsers instead of falling back to a stale site icon.
  base: process.env.VITE_BASE_URL || '/emergent-interaction-lab/',
  test: {
    // Only pure-logic modules (e.g. lib/svgPanZoom.ts) are unit-tested today
    // — no component/DOM tests exist yet, so a 'node' environment is enough
    // and skips pulling in jsdom.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
