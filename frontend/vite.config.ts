import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import institutionalFacts from './institutional-facts.json'

const chapterRoutes = [
  'lab', 'research', 'methods', 'systems', 'publications', 'observatory', 'notes', 'applied-research',
  'research-complex', 'research-behavioral', 'research-reconstruction', 'research-human-ai',
  'research-integrity', 'research-causality', 'research-computational',
  // Transitional aliases keep already-shared beta links alive.
  'about', 'method', 'papers', 'products', 'pricing',
]

// Content mirrors the 2026-09 EIL_Complete_Website_REVISED_v2 package
// (see InstitutionalSite.tsx). Kept in sync with that component so
// no-JS/pre-hydration visitors and crawlers see the same claims as the
// hydrated app — in particular: no "EIL World Model" (DINGIR is the only
// world-state system), EIL Kernel represented as built, Observatory as
// in development.
const staticFallback: Record<string, string> = {
  home: `<p>Emergent Interaction Lab</p><h1>EMERGENT INTERACTION LAB</h1><p>UNABHÄNGIGES FORSCHUNGSLABOR</p><p>EIL untersucht, wie menschliche, computational und sozio-technische Systeme sich verhalten, interagieren, verändern und beobachtbar werden.</p><div class="hero-actions"><a class="button primary" href="#research">Forschung ansehen →</a><a class="button secondary" href="#methods">Methoden</a></div><div class="pill-row"><span class="pill">Emergent Interaction</span><span class="pill">Complex Systems</span><span class="pill">System Reconstruction</span><span class="pill">Intelligence Architecture</span><span class="pill">Multi-Agent Systems</span><span class="pill">DINGIR</span></div><h2>One lab. Multiple interacting research layers.</h2><p>EIL is not a framework collection, a Human–AI lab only, or an agent catalogue. Its work connects interaction, system dynamics, reconstruction, intelligence architecture, runtime integrity, causality, experimentation and evaluation.</p><h2>Infrastructure &amp; active research systems</h2><p>EIL Kernel — Built. DINGIR — Active Research. Observatory — In Development.</p>`,
  lab: '<p>Lab</p><h1>Lab</h1><p>An interdisciplinary environment for reconstructing and designing complex intelligent systems.</p><p>EIL investigates emergence, interaction, hidden state, system behavior and intelligence across human, computational and socio-technical systems.</p><h2>What EIL is</h2><p>Emergent Interaction · Reconstruction · Intelligent Architectures.</p><h2>Founder</h2><p>Laura Serna Gaviria founded EIL. Her work centers on research architecture, intelligence design, multi-agent architecture, system reconstruction, hidden-state reasoning, behavioral/system analysis, causal and transition logic, evaluation architecture and experimental research design.</p><h2>Relationship with RFI-IRFOS</h2><p>EIL and RFI-IRFOS are distinct. Collaborative systems must separate research/intelligence architecture from technical implementation and infrastructure contributions instead of attributing all work to one side.</p>',
  research: '<p>Research</p><h1>Research</h1><p>Research domains connected by interaction, state and system change.</p><h2>Domains</h2><p>Emergent &amp; Complex Systems · Behavioral &amp; Interaction Intelligence · System Reconstruction · Human–AI Systems · System Integrity &amp; Runtime · Causality, Prediction &amp; DINGIR · Intelligent &amp; Computational Research Systems.</p>',
  methods: '<p>Methodology</p><h1>Methods</h1><p>Methods and instruments developed inside EIL research. These are supporting research tools and remain subordinate to the research questions and systems they support.</p><h2>Instruments</h2><p>LIIE (Longitudinal Interaction Impact Evaluation) · IEIA / EIA · CEI (Continuous Evolution Index) · UIP / CCET · LSG-24 / LAP-1 / LT-Data · 8-Layer Model.</p>',
  systems: `<p>Computational research</p><h1>Systems</h1><p>Designed intelligence across agents, runtime and research systems. Individual agents are specialized intelligence components inside larger architectures — not standalone chatbot products.</p><h2>Multi-agent architecture</h2><p>The current architecture includes roughly 15 specialized lead agents and more than ${institutionalFacts.specializedResearchAgentCrates} specialized sub-agents across research and operational contexts.</p><h2>Selected intelligence systems</h2><p>JARVIS · NYX · MIRROR · ROBERT · ARGUS · ATLAS · KOPERNIKUS · JANUS · DAEDALUS · DELTA.</p><h2>EIL Kernel — Built</h2><p>Existing runtime foundation for stateful agent and research systems, including runtime, state, context, memory, monitoring, evidence, recovery, tests and audit trails.</p><h2>DINGIR — Active Research</h2><p>The collaborative system for hidden-state reconstruction, causal chains, state transitions and predictive reasoning. Evidence → Hidden State → Causal Structure → Transition → Possible Futures. DINGIR is the only world-state system represented; there is no separate EIL World Model.</p>`,
  publications: '<p>Research outputs</p><h1>Publications</h1><p>Publications, benchmarks, datasets, software and technical notes are presented as outputs of the broader EIL research environment.</p>',
  observatory: '<p>Research instrument</p><h1>Observatory</h1><p>Experimental visibility into ongoing research systems — in development.</p><h2>In development</h2><p>Experiments · State &amp; Runtime · Reconstructions · Research Streams · Data · Scientific Visualization. Only implemented elements are labelled operational; the Observatory remains marked in development until verified otherwise.</p>',
  'applied-research': '<p>Applied research</p><h1>Applied Research</h1><p>Research methods applied to bounded real-world systems, without turning the lab into a generic consultancy.</p><h2>Capabilities</h2><p>System Reconstruction · AI-Augmented System Diagnostics · Behavioral / Interaction Analysis · Adversarial Systems Analysis.</p><h2>Process</h2><p>Problem → Research Question → Boundary → Evidence.</p>',
  notes: '<p>Public research communication</p><h1>Research Notes</h1><p>Observations, method notes, experiment notes and research updates are published with explicit status and limitations.</p>',
  'research-complex': '<p>Research Domain</p><h1>Emergent &amp; Complex Systems</h1><p>How local interactions create system-level behavior, adaptation, instability and change.</p><h2>Scope</h2><p>Emergence from distributed interaction · System dynamics across time · Cross-system effects · Feedback and cascades · Interaction-driven state transitions · Nonlinear behavior.</p>',
  'research-behavioral': '<p>Research Domain</p><h1>Behavioral &amp; Interaction Intelligence</h1><p>Using behavior and interaction as evidence about system state, constraints and decision dynamics.</p><h2>Scope</h2><p>Behavioral patterns · Decision dynamics · Interaction effects · Adversarial behavioral analysis · Deviation patterns · Prediction-relevant behavior.</p>',
  'research-reconstruction': '<p>Research Domain</p><h1>System Reconstruction</h1><p>Reconstructing hidden states and mechanisms from incomplete, distributed or longitudinal evidence.</p><h2>Scope</h2><p>Hidden-state reconstruction · Temporal reconstruction · Relationship reconstruction · Constraint discovery · Causal chains · State transitions · Uncertainty and incomplete evidence.</p>',
  'research-human-ai': '<p>Research Domain</p><h1>Human–AI Systems</h1><p>Studying how human and AI behavior co-evolves across long-running interaction rather than isolated sessions.</p><h2>Scope</h2><p>Interaction trajectories · Adaptation · Agency · Dependency · Semantic integrity · HMI / UX · Recovery · Longitudinal evaluation.</p>',
  'research-integrity': '<p>Research Domain</p><h1>System Integrity &amp; Runtime</h1><p>Understanding when intelligent systems degrade without producing an explicit error.</p><h2>Scope</h2><p>Drift · Regression · Contradiction · State divergence · Constraint loss · Repeated unsuccessful behavior · Runtime continuity · Recovery.</p>',
  'research-causality': '<p>Research Domain</p><h1>Causality, Prediction &amp; DINGIR</h1><p>Reconstructing causal structure and system state to reason about transitions and plausible future states. DINGIR is the system represented for this reconstruction and prediction layer.</p><h2>Scope</h2><p>DINGIR · Hidden-state reconstruction · Causal chains · State transitions · Temporal reasoning · Counterfactual reasoning · Forecasting · Uncertainty.</p>',
  'research-computational': '<p>Research Domain</p><h1>Intelligent &amp; Computational Research Systems</h1><p>Designing the computational and intelligence infrastructure needed for stateful, multi-step and multi-agent research.</p><h2>Scope</h2><p>Intelligence Design · Agent Intelligence · Multi-Agent Systems · EIL Kernel · Research runtimes · Data structures · Scientific visualization · Experimental infrastructure.</p>',
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
