# Future Engineering BIM And Construction Agent Framework Draft

Date: 2026-07-02

## Purpose

This document is a future-development framework draft for Agent Pi. It separates the long-term engineering/BIM/construction automation direction from the V1.2.1 document-quality plan.

The central product question is:

Can Agent Pi grow from document writing and source-grounded production into a professional construction engineering workbench that reads PDFs, performs drawing understanding and quantity takeoff, links BOQ quantities to schedules and costs, and generates highway BIM/progress visualizations?

The answer is yes for an assisted, auditable, human-reviewed workflow. The boundary is also clear: Agent Pi should not claim to produce final signed engineering design, statutory design approval, or construction-ready structural conclusions without qualified engineer review.

## Research Basis

Primary and technical references checked:

- PDF extraction:
  - [PyMuPDF Page API](https://pymupdf.readthedocs.io/en/latest/page.html) exposes page text, OCR text pages, tables, vector drawings, images, pixmaps, SVG export, and coordinate-aware page methods.
  - [pdfplumber](https://github.com/jsvine/pdfplumber) exposes PDF characters, lines, rectangles, curves, images, and tables, useful for drawing-like PDF inspection.
  - [Apache PDFBox](https://pdfbox.apache.org/) is a mature PDF processing toolkit for text/image/document operations.
  - [OpenCV](https://docs.opencv.org/) provides image processing building blocks for raster drawing recognition, contour detection, line detection, and preprocessing.
- OpenBIM / highway BIM:
  - [buildingSMART IFC](https://www.buildingsmart.org/standards/bsi-standards/industry-foundation-classes/) is the core openBIM exchange standard.
  - [IFC4.3 IfcRoad](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcRoad.htm) and [IfcAlignment](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcAlignment.htm) are relevant to road/corridor modeling.
  - [Bonsai / IfcOpenShell](https://docs.ifcopenshell.org/bonsai.html) provides open-source Blender-linked IFC authoring and inspection capabilities.
  - [GeoJSON RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946), [OGC GeoPackage](https://docs.ogc.org/is/12-128r17/12-128r17.html), and [QGIS Print Layout](https://docs.qgis.org/latest/en/docs/user_manual/print_layout/index.html) are useful for geospatial model exchange and map deliverables.
- 3D / modeling / simulation:
  - [Blender Python API](https://docs.blender.org/api/current/) can automate scene creation and visualization.
  - [Blender unit settings](https://docs.blender.org/manual/en/latest/scene_layout/scene/properties.html) exist, but Blender should not be the sole source of engineering truth for precision design.
  - [FreeCAD](https://wiki.freecad.org/) and OpenCASCADE-style parametric CAD workflows are better suited for precision geometry.
  - [OpenSeesPy](https://openseespydoc.readthedocs.io/), [CalculiX](https://www.calculix.de/), [Code_Aster](https://code-aster.org/), and [PyMAPDL](https://mapdl.docs.pyansys.com/) are possible structural/FEA automation backends when used with explicit model assumptions and review.
- Standards and responsibility boundaries:
  - Structural and design-code workflows depend on jurisdiction-specific standards such as [Eurocodes](https://eurocodes.jrc.ec.europa.eu/), [ASCE 7](https://www.asce.org/publications-and-news/codes-and-standards/asce-sei-7-22), and [ACI 318](https://www.concrete.org/topicsinconcrete/318buildingcodeportal.aspx). These cannot be replaced by LLM inference.

## Product Boundary

Agent Pi can reasonably evolve into:

- a PDF drawing understanding assistant;
- a quantity takeoff and BOQ reconciliation assistant;
- a schedule quantity-splitting and progress visualization assistant;
- a 4D/5D construction planning assistant;
- an OpenBIM/IFC and highway corridor modeling assistant;
- a simulation/structural calculation preparation and report assistant.

Agent Pi should not claim to be:

- a fully automatic statutory design system;
- a substitute for a licensed structural engineer, quantity surveyor, BIM manager, planner, or designer;
- a black-box generator of construction-ready design drawings from PDFs alone;
- a source of final code compliance unless the rule package, source standard, version, jurisdiction, and human approval are explicit.

Recommended positioning:

> Agent Pi automates extraction, modeling, calculation preparation, comparison, reporting, and audit. Professional users retain responsibility for assumptions, design judgment, and final approval.

## Current App Extensibility Check: Claude SDK And Pi

The current Claude SDK and Pi backend layers are not the main blocker for the engineering/BIM direction. They already provide enough extension surface for assisted professional workflows if the professional capability is implemented as deterministic tools, MCP sources, artifact manifests, and review gates rather than as prompt-only behavior.

Current extension surfaces that matter:

- MCP and API sources can be mounted per workspace and exposed to both Claude SDK and Pi sessions.
- Session tools can create, validate, and activate sources during a task, including file-memory MCP sources generated from Markdown/JSON/TXT artifacts.
- Local tools can run extractors, converters, validators, data transforms, and script sandboxes.
- Project Memory Lite can preserve project-local decisions, citations, source evidence, and Goal Loop audit summaries.
- The Goal Loop can already audit outputs and trigger correction turns; this is the right place to add engineering-quality checks.

Therefore the product direction should not require replacing Claude SDK or Pi first. The safer path is:

```text
Professional workflow requirement
→ deterministic extractor / renderer / validator
→ source-backed manifest and artifact registry
→ MCP or session tool wrapper
→ agent orchestration through Claude SDK or Pi
→ Goal Loop audit and human review
```

Capabilities still missing before the app can credibly support deep construction engineering work:

- long-running job orchestration for OCR, drawing recognition, BIM generation, and simulation;
- professional artifact registry for drawings, quantities, schedules, BIM files, solver runs, rendered figures, and audit evidence;
- rule packages for measurement methods, contract standards, design-code formulas, and jurisdiction-specific assumptions;
- visual review UI for drawing bounding boxes, quantity sampling, schedule packages, BIM model previews, and simulation result checks;
- permission, provenance, and data-isolation rules for shared enterprise/company knowledge.

The key boundary is that Claude SDK and Pi can orchestrate this work, but they should not be treated as the calculation engine or the source of engineering truth. The calculation, extraction, conversion, rendering, and compliance evidence must live in audited tools and structured sidecars.

## Strategic Architecture

Use a layered pipeline rather than one monolithic "AI reads drawing and outputs BIM" feature.

```text
Project Inputs
  PDFs / scans / BOQ / specifications / schedules / site conditions / GIS
      ↓
Document And Drawing Intelligence
  OCR, vector extraction, title-block parsing, sheet registry, scale calibration
      ↓
Engineering Evidence Model
  drawings, elements, dimensions, quantities, chainage, WBS, BOQ links, source citations
      ↓
Domain Engines
  quantity takeoff, cost, schedule, BIM, GIS, simulation, structural analysis preparation
      ↓
Deliverables
  Markdown reports, Excel tables, BOQ split, P6/Project XML, IFC/GeoJSON/LandXML, SVG/PNG/PDF/DOCX
      ↓
Audit And Human Review
  confidence, missing data, sampling checks, manual acceptance gates
```

The Engineering Evidence Model is the most important layer. It should hold traceable facts rather than prose:

```ts
interface DrawingEvidence {
  drawingId: string
  filePath: string
  sheetNo?: string
  revision?: string
  title?: string
  discipline?: 'road' | 'drainage' | 'structures' | 'earthworks' | 'utilities' | 'general'
  page: number
  scale?: string
  units?: string
  bbox?: [number, number, number, number]
  confidence: number
  sourceNote: string
}

interface QuantityEvidence {
  id: string
  boqItemId?: string
  wbsCode?: string
  drawingRefs: DrawingEvidence[]
  method: 'vector_measurement' | 'dimension_text' | 'table_extraction' | 'manual_user_input' | 'model_quantity'
  quantity: number
  unit: string
  location?: string
  chainageStart?: string
  chainageEnd?: string
  confidence: number
  reviewRequired: boolean
}
```

## Direction 1: PDF Drawing Recognition And Understanding

### Key Requirement

The app should distinguish between:

- vector PDF drawings, where linework/text/dimensions can be extracted;
- scanned raster drawings, where OCR and computer vision are required;
- hybrid PDFs, where title blocks/text may be extractable but geometry is raster;
- exported CAD drawings with layers or optional content groups, where extraction quality can be higher.

### Recommended Workflow

1. Intake and sheet registry
   - Hash each PDF.
   - Split pages into sheets.
   - Detect sheet size, orientation, title block, drawing number, revision, discipline, scale, and date.
   - Create a `drawing-register.jsonl`.

2. Page calibration
   - Detect drawing scale from title block or scale bar.
   - Detect unit system.
   - Support multiple viewports/scales on one sheet.
   - Require manual confirmation when scale confidence is low.

3. Extraction
   - Vector PDF: extract text, lines, rectangles, curves, images, tables, and vector paths.
   - Raster PDF: render high-resolution page image, deskew, denoise, OCR, detect lines/symbols/contours.
   - Hybrid PDF: combine both and keep provenance per element.

4. Semantic interpretation
   - Classify drawing type: plan, profile, cross-section, detail, schedule/table, general notes, reinforcement detail, drainage layout, road alignment, pavement layer, structure drawing.
   - Recognize common objects: centerline, chainage, levels, pavement layers, drainage pipes, culverts, retaining walls, bridges, earthworks sections, road furniture, utilities.
   - Extract dimension strings and associate them with geometry.

5. Evidence output
   - Every recognized element must link back to page, bbox, drawing revision, and extraction method.
   - Low-confidence items are not silently used for quantities.

### Practical Boundary

PDF drawings are not CAD/BIM. They may lack object semantics, hidden dimensions, layer structure, or reliable scale. Agent Pi should use PDF drawings for assisted recognition and quantity evidence, not assume complete model reconstruction.

## Direction 2: Quantity Takeoff From Drawings

### Target Workflow

```text
PDF drawings + BOQ + specifications
→ drawing register
→ element recognition
→ measurement candidates
→ BOQ item mapping
→ quantity split by location/WBS/chainage
→ reviewer sampling
→ takeoff report + BOQ reconciliation table
```

### Quantity Methods

- Direct measurement from vector geometry: lengths, areas, counts.
- Dimension-text extraction: use explicit dimensions where geometry scale is unreliable.
- Schedule/table extraction: reinforcement schedules, culvert schedules, drainage schedules, pavement layer tables.
- Cross-section computation: use chainage, widths, layer thicknesses, cut/fill areas.
- User-confirmed assumptions: only when source drawings are incomplete.
- BIM/model quantities: once IFC/corridor model exists.

### BOQ Mapping

The app should maintain a `Measurement Rulebook`:

```ts
interface MeasurementRule {
  boqItemPattern: string
  discipline: string
  unit: string
  measurementBasis: string
  expectedSources: string[]
  splitDimensions: Array<'chainage' | 'zone' | 'drawing' | 'structure' | 'work_package'>
  requiresManualReview: boolean
}
```

Example mapping:

- Earthworks BOQ item -> cross-section areas, chainage range, material classification.
- Pavement layer BOQ item -> length x width x thickness by chainage.
- Drainage pipe BOQ item -> centerline length by diameter/class.
- Culvert BOQ item -> count/length by type and location.
- Road marking item -> length/area from layout drawings.
- Structures item -> concrete/rebar/formwork from schedules and detail drawings.

### Audit Rules

The quantity engine must output:

- quantity value;
- unit;
- source drawing and page;
- bbox or table reference;
- method used;
- confidence score;
- reviewer sampling flag;
- difference versus BOQ quantity;
- reason for difference.

If a quantity cannot be grounded, it should appear in a "requires manual takeoff" table.

## Direction 3: Progress Schedule Splitting By BOQ And Drawings

### Goal

Turn a master schedule into a quantity-loaded, location-aware, BOQ-linked progress plan.

```text
BOQ item
→ drawing-derived quantity
→ chainage / zone / structure split
→ activity package
→ productivity and crew assumption
→ duration and cost distribution
→ P6 / Project / Candy-compatible schedule
→ progress visualization
```

### Required Data Model

```ts
interface QuantitySchedulePackage {
  packageId: string
  wbsCode: string
  boqItemIds: string[]
  drawingRefs: DrawingEvidence[]
  location: string
  chainageStart?: string
  chainageEnd?: string
  quantity: number
  unit: string
  productivity?: number
  crew?: string
  plannedStart?: string
  plannedFinish?: string
  costAmount?: number
  confidence: number
}
```

### Outputs

- Quantity-loaded WBS.
- BOQ-to-schedule mapping table.
- Chainage/zone package map.
- Resource/cost histogram.
- S-curve by quantity and cost.
- Progress dashboard with planned vs actual quantities.
- P6/Project XML export using the existing construction schedule skill direction.

### Important Rule

The app should not automatically invent productivity. Productivity rates must come from:

- user-provided company productivity database;
- historical project memory;
- contract specification;
- verified external reference;
- explicit user assumption.

## Direction 4: Finer Construction Cost And Planning Service

This direction turns documents and drawings into construction planning intelligence:

- BOQ structure normalization.
- Cost database normalization.
- Resource buildup by crew, plant, material, subcontract.
- Productivity assumption register.
- Direct cost, indirect cost, preliminaries, risk allowance.
- Method statement to schedule activity generation.
- Drawing quantity to BOQ quantity variance analysis.
- Cost-loaded schedule and earned-value-ready progress structure.
- Procurement and long-lead package schedule.
- Construction method options comparison.

Recommended outputs:

- `boq-normalized.xlsx`
- `drawing-takeoff-register.xlsx`
- `quantity-boq-reconciliation.md`
- `schedule-quantity-packages.json`
- `p6-project.xml`
- `cost-loaded-schedule-report.md`
- `progress-dashboard.md`

## Direction 5: Highway PDF Drawings To BIM

### Product Goal

For road/highway projects, the app should assist users in turning PDF drawing packages into a traceable corridor model and construction visualization, not pretend to recover perfect CAD/BIM automatically.

### Highway Data To Extract

- Project coordinate system and datum.
- Horizontal alignment.
- Vertical profile.
- Chainage/stationing.
- Typical cross sections.
- Pavement layer build-up.
- Earthworks limits.
- Drainage network and culverts.
- Structures and retaining walls.
- Utilities and services.
- Road furniture, signage, barriers, markings.
- Construction staging and traffic accommodation.

### Recommended BIM Workflow

```text
PDF drawing package
→ sheet register and drawing classification
→ alignment/profile/cross-section extraction
→ chainage-based corridor schema
→ GeoJSON/LandXML-like intermediate data
→ IFC4.3 road/alignment entities where feasible
→ Bonsai/IfcOpenShell/Blender visualization
→ schedule activities linked to chainage and BOQ packages
→ 4D progress visualization and report figures
```

### Why IFC4.3 Matters

IFC4.3 includes infrastructure concepts such as road and alignment entities. This makes it more appropriate than a pure mesh or `.blend` file for future road BIM exchange. Blender/Bonsai can still be valuable for visualization, QA screenshots, and model exploration, but the durable project data should be IFC/GeoJSON/LandXML-like structured data.

### Highway BIM Outputs

- `drawing-register.jsonl`
- `alignment.json`
- `cross-sections.json`
- `corridor-quantities.json`
- `road-model.ifc`
- `road-model.blend` or generated preview model
- `chainage-package-map.svg`
- `4d-progress-visualization.md`
- `highway-bim-audit-report.md`

## Direction 6: Blender, BIM, And Precision Modeling

### Role Of Blender

Blender is suitable for:

- visual model generation;
- construction staging animation;
- report images;
- progress visualization;
- BIM inspection through Bonsai/IfcOpenShell;
- simple parametric visual scenes.

Blender is not ideal as the sole source for:

- statutory engineering model;
- precise CAD constraints;
- formal structural analysis model;
- quantity source of truth unless linked to IFC/structured data.

Recommended approach:

```text
Structured engineering model
→ IFC / GeoJSON / schedule / quantity data
→ Blender/Bonsai scene generation
→ visual QA and report output
```

## Direction 7: Structural Design And Simulation Boundary

The app can assist with:

- extracting design requirements;
- listing missing inputs;
- building preliminary analysis models;
- preparing OpenSees/CalculiX/Code_Aster/Ansys input files;
- parsing solver outputs;
- generating calculation reports;
- checking selected rule-package formulas;
- creating review checklists.

The app should not automatically certify:

- complete building structural design;
- foundation design without geotechnical input;
- seismic/wind design without jurisdictional parameters;
- code compliance where the relevant rule package is not implemented and tested;
- final design drawings for construction.

Required safety gates:

- jurisdiction and code version;
- load assumptions;
- material grades;
- soil parameters;
- model boundary conditions;
- units;
- solver version;
- manual engineer review.

## Development Roadmap

### Phase A: Drawing Intelligence Foundation

Build the sheet register, PDF classification, vector/raster extraction, title-block parsing, scale calibration, and evidence model.

Minimum deliverables:

- drawing register;
- OCR/vector extraction sidecars;
- drawing preview with detected bboxes;
- confidence and audit report.

### Phase B: Quantity Takeoff Assistant

Build measurement candidates, BOQ mapping, quantity reconciliation, and review sampling.

Minimum deliverables:

- takeoff register;
- BOQ reconciliation table;
- source-linked quantity report;
- manual-review queue.

### Phase C: BOQ-Schedule-Cost Integration

Build quantity package splitting, activity generation, cost/resource allocation, and P6/Project export.

Minimum deliverables:

- quantity-loaded WBS;
- package-by-chainage schedule;
- S-curve and histogram;
- schedule export and validation report.

### Phase D: Highway BIM And 4D Visualization

Build road/corridor schema, alignment/cross-section extraction, IFC/GeoJSON outputs, and Blender/Bonsai visualization.

Minimum deliverables:

- road corridor data model;
- IFC/GeoJSON prototype;
- chainage model visualization;
- 4D progress animation or staged report figures.

### Phase E: Engineering Simulation And Structural Assistance

Build limited-domain model generation and solver integration for selected repeatable scenarios.

Candidate first scenarios:

- simple beams;
- culverts;
- retaining walls;
- temporary works;
- equipment foundations;
- steel frames;
- pipe supports;
- bridge component checks where inputs are complete.

Minimum deliverables:

- model input file;
- solver run manifest;
- result parser;
- calculation report;
- human review checklist.

## Recommended First Vertical: Highway Tender Workbench

The most valuable first vertical for the user's existing use cases is not "generic building design". It is a highway/civil tender workbench:

```text
PDF drawings + BOQ + tender specs
→ drawing register
→ discipline classification
→ road/earthworks/drainage/structures quantity extraction
→ BOQ reconciliation
→ activity package split by chainage/WBS
→ cost-loaded planning report
→ P6/Project XML
→ chainage progress visualization
→ Markdown/PDF/DOCX tender planning deliverables
```

Reasons:

- The user's recurring work already involves tender PDFs, BOQ, schedules, and construction reports.
- Highway/civil work is naturally chainage/WBS/BOQ driven.
- Many useful outputs can be achieved before perfect BIM is solved.
- The product can show clear value through auditability and source-linked quantities.

## Key Risks

- PDF drawing scale and geometry may be unreliable.
- Scanned drawings require OCR/CV and will have lower confidence.
- BOQ descriptions may not match drawing terminology.
- Multiple drawing revisions may conflict.
- Standards and measurement rules differ by jurisdiction and contract.
- BIM from PDF may create a visually plausible but semantically wrong model.
- Productivity and cost assumptions can materially affect planning outputs.
- Structural analysis output can be misused as final design approval.

## Non-Negotiable Audit Rules

- Every quantity must cite source drawing/page/bbox or be marked manual/user-provided.
- Every model element must identify whether it came from drawing extraction, BOQ, specification, user input, or inference.
- Every schedule duration derived from productivity must cite the productivity source.
- Every cost value must cite rate source and currency/date.
- Every BIM element must keep source references.
- Every simulation result must cite solver, version, model input, units, load case, and boundary assumptions.
- Low-confidence automated results must enter a review queue.

## Suggested Product Framing

Do not frame this future direction as:

> automatic engineering design from drawings.

Frame it as:

> source-grounded engineering production assistance: drawing intelligence, quantity evidence, BOQ reconciliation, construction planning, BIM-assisted visualization, and auditable calculation/report generation.

This framing matches the application's current strength: long-task document production with project memory, source citations, output files, and self-auditing.
