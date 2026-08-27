import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import institutionalFacts from './institutional-facts.json'

const chapterRoutes = [
  'lab', 'research', 'methods', 'systems', 'publications', 'observatory', 'notes', 'applied-research',
  // Transitional aliases keep already-shared beta links alive.
  'about', 'method', 'papers', 'products', 'pricing',
]

const staticFallback: Record<string, string> = {
  home: `<p>Emergent Interaction Lab</p><h1>Researching behavior, interaction, system dynamics and evidence across human, computational and socio-technical systems.</h1><p>EIL combines HMI, behavioral analysis, agentic systems research, reconstruction, evidence architecture and adversarial systems thinking to investigate how systems actually behave, change and become observable.</p><h2>Why this research exists</h2><p>A system is more than its formal description. Software, AI and organizations also reveal themselves through behavior, interaction, deviation, relationships and change over time.</p><h2>Objects of Study</h2><p>AI and agentic systems · Human–Machine Systems · Software and Digital Systems · Organizations and Processes · Complex Evidence Environments · Socio-Technical Systems</p><h2>Analytical Perspectives</h2><p>HMI · Behavioral Analysis · Agentic Systems · Reconstruction · Evidence Architecture · Adversarial Systems Thinking</p><h2>Seven connected Research Domains</h2><p>Complex Systems and Emergence · Behavioral Intelligence · System Reconstruction · Human–AI Dynamics · System Integrity · Prediction and Causality · Computational Research Systems.</p><h2>Research Environment</h2><p>${institutionalFacts.specializedResearchAgentCrates} individually authored specialist Rust crates, a Research Knowledge Graph, the EIL World Model and Observatory support long-running investigations.</p><h2>Evidence and outputs</h2><p>Claims remain linked to source, evidence status and uncertainty. Outputs include publications, methods, datasets, models, research systems, evidence graphs, reconstructions, technical reports and research notes.</p><h2>Applied Research</h2><p>Selected capabilities can support bounded external investigations with an explicit research question, system boundary, evidence base and output artifact.</p>`,
  lab: '<p>Institution</p><h1>Emergent Interaction Lab</h1><p>Independent founder-led research lab investigating behavior, interaction, system dynamics and evidence where formal descriptions or isolated outputs are insufficient.</p><h2>Mission</h2><p>The Lab investigates systems where behavior, interaction and evidence reveal more than formal description alone.</p><h2>Why these fields meet here</h2><p>HMI, Behavioral Analysis, Agentic Systems, Reconstruction, Evidence Architecture and Adversarial Systems Thinking answer different questions about related analytical problems.</p><h2>Laura</h2><p>Founder · Research Lead · Method Developer · Research Architect.</p><h2>Research Lineage</h2><p>Human analytical practice and recurring research requirements → repeated analytical operations → methods and protocols → specialized research roles → computational research infrastructure → persistent research state → longitudinal observation. EIL does not only use computational tools: parts of its analytical practice are progressively formalized into inspectable computational research systems. Simplified conceptual lineage, not a strict historical pipeline.</p><h2>Research Principles</h2><p>Evidence before narrative. Observation is not explanation. Reported state is not observed state. Unknowns remain explicit. Prediction is not certainty. Contradictions are information. Correlation is not causality. Stronger claims require stronger evidence.</p><h2>EIL and RFI-IRFOS</h2><p>Independent entities with distinct research and engineering scopes; neither is subordinate to the other.</p>',
  research: '<p>Research</p><h1>Research domains and questions</h1><p>Research Domains organize the field; analytical perspectives connect different questions around the same research object.</p><h2>Domains</h2><p>Complex Systems and Emergence · Human–AI Dynamics · Behavioral Intelligence · System Reconstruction · Prediction and Causality · System Integrity · Computational Research Systems.</p><h2>Current research questions</h2><p>How does interface representation change perception and decision? When does agent coordination produce system-level behavior? How should uncertainty, provenance and contradiction remain distinct? When does longitudinal evidence justify prediction rather than correlation? How do roles change under sustained human–AI interaction?</p>',
  methods: '<p>Public methodology</p><h1>Methods and capabilities</h1><p>Observe → Attribute → Separate → Contextualize → Reconstruct → Challenge → Model → Validate. Simplified public research logic; not an implementation specification.</p><h2>Analytical Methods</h2><p>Outside-In System Inference · State Separation · Contradiction Mapping · Constraint Discovery · Behavioral Drift Analysis · Longitudinal Validation.</p><h2>Evidence Architecture</h2><p>Observed · Reported · Derived · Inferred · Hypothesized · Unknown. Provenance retains source, time, context and transformation; contradiction remains separate.</p><h2>Framework separation</h2><p>Frameworks remain distinct from methods, metrics and infrastructure.</p>',
  systems: `<p>Computational research</p><h1>Systems and infrastructure</h1><p>Research infrastructure exists to make long-running, multi-perspective investigation inspectable.</p><h2>Research Environment</h2><p>Specialized Research Agents perform bounded operations. The Research Knowledge Graph connects evidence and relationships. The EIL World Model represents state, change, alternatives and uncertainty. The Observatory follows dynamics longitudinally.</p><h2>Systems</h2><p>Multi-Agent Research Environment · Research Knowledge Graph · EIL World Model · Jarvis · Call Laura · Observatory.</p><h2>Knowledge Graph versus World Model</h2><p>The Knowledge Graph asks how what we know is connected. The EIL World Model asks what representation of state and change current evidence supports.</p><h2>Agent environment</h2><p>${institutionalFacts.specializedResearchAgentCrates} individually authored specialist Rust crates are invoked by an orchestrator for bounded research functions. They are not votes; agreement does not replace evidence.</p>`,
  publications: '<p>Research outputs</p><h1>Publications</h1><p>Research outputs are listed with authorship, version, status and peer-review status. Repository release or DOI does not imply peer review.</p>',
  observatory: '<p>Research instrument</p><h1>Observatory</h1><p>A longitudinal instrument for interaction patterns, semantic drift, role stability, state transitions, contradictions and context accumulation.</p><h2>Observation is not explanation</h2><p>The Observatory makes signals and evidence coverage visible; it does not turn correlation into causality or infer intention from behavioral traces.</p><h2>Six dimensions</h2><p>Interaction Dynamics: recurring patterns over time. Semantic Drift: changes in meaning and reference. Role Stability: persistence of roles and boundaries. State Transitions: observations supporting relevant change. Contradictions: evidence challenging a current model. Context Accumulation: signals visible only across longer histories.</p><h2>Preview architecture</h2><p>System State · Interaction Dynamics · Behavioral Landscape · Role Integrity · Semantic Drift · Contradiction Map · State Transitions · Evidence Coverage · Research Pulse · Experiments.</p>',
  'applied-research': '<p>Applied research</p><h1>Applied Research</h1><p>Selected EIL capabilities can be applied to bounded external investigations with explicit evidence limits and output artifacts.</p><h2>Capabilities</h2><p>System Reconstruction · System Integrity Analysis · Behavioral and Interaction Analysis · HMI Analysis · Agentic Systems Analysis · Evidence Architecture · Adversarial Analysis.</p><h2>Engagement levels</h2><p>ASSESS clarifies scope. INVESTIGATE performs in-depth analysis. BUILD develops research or system architecture. MONITOR observes change longitudinally. Capabilities and commercial offers remain separate categories.</p><h2>Process</h2><p>Scope → Evidence → Investigation → Reconstruction or Analysis → Deliverable → Optional Engineering.</p>',
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
