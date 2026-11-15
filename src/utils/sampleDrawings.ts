import type { DrawingAnalysisResult } from '../types/cad';

export interface SampleDrawingPreset {
  id: string;
  title: string;
  subtitle: string;
  fileName: string;
  assetUrl?: string;
  analysis: DrawingAnalysisResult;
}

export const SAMPLE_DRAWINGS: SampleDrawingPreset[] = [
  {
    id: 'spur-gear-shaft',
    title: 'Precision Spur Gear Shaft (Multi-View)',
    subtitle: '4140 Steel · 3 Linked Views · Lathe, Milling, Hobbing & Grinding',
    fileName: 'Precision_Spur_Gear_Shaft_DWG418.pdf',
    analysis: {
      partName: 'Precision Spur Gear Shaft',
      partNumber: 'DWG-418-D',
      revision: 'Rev D',
      units: 'mm',
      material: '4140 Alloy Steel',
      stockEnvelope: {
        length: 132,
        width: 58,
        thickness: 58,
        form: 'Round Bar',
      },
      generalTolerance: 'ISO 2768-f (±0.05 mm)',
      surfaceFinishDefault: 'Ra 0.8 µm',
      boundingBox: { minX: -95, minY: -55, maxX: 95, maxY: 60 },
      viewChunks: [
        {
          id: 'view-ortho',
          label: 'Orthogonal Front',
          viewKind: 'orthogonal',
          pageNumber: 1,
          normBounds: { x: 0.05, y: 0.11, w: 0.44, h: 0.38 },
          sheetOffset: { dx: -44, dy: 24 },
        },
        {
          id: 'view-long-sec',
          label: 'Longitudinal Section A-A',
          viewKind: 'longitudinal-section',
          pageNumber: 1,
          normBounds: { x: 0.05, y: 0.52, w: 0.44, h: 0.38 },
          sheetOffset: { dx: -44, dy: -28 },
        },
        {
          id: 'view-cross-sec',
          label: 'Cross-Section B-B',
          viewKind: 'cross-section',
          pageNumber: 1,
          normBounds: { x: 0.53, y: 0.14, w: 0.41, h: 0.56 },
          sheetOffset: { dx: 54, dy: 8 },
        },
      ],
      entities: [
        // --- VIEW 1: ORTHOGONAL FRONT (centered around (-44, 24)) ---
        {
          id: 'gs-v1-top',
          viewId: 'view-ortho',
          featureId: 'feat-gs-journals',
          layer: 'outline',
          type: 'polyline',
          closed: false,
          points: [
            { x: -90, y: 34 },
            { x: -64, y: 34 },
            { x: -64, y: 49 },
            { x: -24, y: 49 },
            { x: -24, y: 36 },
            { x: 6, y: 36 },
          ],
        },
        {
          id: 'gs-v1-bot',
          viewId: 'view-ortho',
          featureId: 'feat-gs-journals',
          layer: 'outline',
          type: 'polyline',
          closed: false,
          points: [
            { x: -90, y: 14 },
            { x: -64, y: 14 },
            { x: -64, y: -1 },
            { x: -24, y: -1 },
            { x: -24, y: 12 },
            { x: 6, y: 12 },
          ],
        },
        { id: 'gs-v1-e0', viewId: 'view-ortho', featureId: 'feat-gs-journals', layer: 'outline', type: 'line', x1: -90, y1: 14, x2: -90, y2: 34 },
        { id: 'gs-v1-e1', viewId: 'view-ortho', featureId: 'feat-gs-gear', layer: 'outline', type: 'line', x1: -64, y1: -1, x2: -64, y2: 49 },
        { id: 'gs-v1-e2', viewId: 'view-ortho', featureId: 'feat-gs-gear', layer: 'outline', type: 'line', x1: -24, y1: -1, x2: -24, y2: 49 },
        { id: 'gs-v1-e3', viewId: 'view-ortho', featureId: 'feat-gs-journals', layer: 'outline', type: 'line', x1: 6, y1: 12, x2: 6, y2: 36 },
        { id: 'gs-v1-pitch1', viewId: 'view-ortho', featureId: 'feat-gs-gear', layer: 'hidden', type: 'line', x1: -64, y1: 45, x2: -24, y2: 45 },
        { id: 'gs-v1-pitch2', viewId: 'view-ortho', featureId: 'feat-gs-gear', layer: 'hidden', type: 'line', x1: -64, y1: 3, x2: -24, y2: 3 },
        { id: 'gs-v1-kw', viewId: 'view-ortho', featureId: 'feat-gs-keyway', layer: 'outline', type: 'rect', x: -18, y: 21, width: 18, height: 6, rx: 3 },
        { id: 'gs-v1-cl', viewId: 'view-ortho', layer: 'centerline', type: 'line', x1: -95, y1: 24, x2: 12, y2: 24 },

        // --- VIEW 2: LONGITUDINAL SECTION A-A (centered around (-44, -28)) ---
        {
          id: 'gs-v2-outer-top',
          viewId: 'view-long-sec',
          featureId: 'feat-gs-journals',
          layer: 'outline',
          type: 'polyline',
          closed: false,
          points: [
            { x: -90, y: -18 },
            { x: -64, y: -18 },
            { x: -64, y: -3 },
            { x: -24, y: -3 },
            { x: -24, y: -16 },
            { x: 6, y: -16 },
          ],
        },
        {
          id: 'gs-v2-outer-bot',
          viewId: 'view-long-sec',
          featureId: 'feat-gs-journals',
          layer: 'outline',
          type: 'polyline',
          closed: false,
          points: [
            { x: -90, y: -38 },
            { x: -64, y: -38 },
            { x: -64, y: -53 },
            { x: -24, y: -53 },
            { x: -24, y: -40 },
            { x: 6, y: -40 },
          ],
        },
        { id: 'gs-v2-endL', viewId: 'view-long-sec', featureId: 'feat-gs-bore', layer: 'outline', type: 'line', x1: -90, y1: -38, x2: -90, y2: -18 },
        { id: 'gs-v2-endR', viewId: 'view-long-sec', featureId: 'feat-gs-bore', layer: 'outline', type: 'line', x1: 6, y1: -40, x2: 6, y2: -16 },
        // Internal hollow bore Ø12 thru shown in Longitudinal Section
        { id: 'gs-v2-bore-t', viewId: 'view-long-sec', featureId: 'feat-gs-bore', layer: 'hole', type: 'line', x1: -90, y1: -22, x2: 6, y2: -22 },
        { id: 'gs-v2-bore-b', viewId: 'view-long-sec', featureId: 'feat-gs-bore', layer: 'hole', type: 'line', x1: -90, y1: -34, x2: 6, y2: -34 },
        // Section hatch lines
        { id: 'gs-v2-h1', viewId: 'view-long-sec', layer: 'hidden', type: 'line', x1: -84, y1: -22, x2: -80, y2: -18 },
        { id: 'gs-v2-h2', viewId: 'view-long-sec', layer: 'hidden', type: 'line', x1: -72, y1: -22, x2: -68, y2: -18 },
        { id: 'gs-v2-h3', viewId: 'view-long-sec', layer: 'hidden', type: 'line', x1: -56, y1: -22, x2: -37, y2: -3 },
        { id: 'gs-v2-h4', viewId: 'view-long-sec', layer: 'hidden', type: 'line', x1: -42, y1: -22, x2: -25, y2: -5 },
        { id: 'gs-v2-h5', viewId: 'view-long-sec', layer: 'hidden', type: 'line', x1: -16, y1: -22, x2: -10, y2: -16 },
        { id: 'gs-v2-cl', viewId: 'view-long-sec', layer: 'centerline', type: 'line', x1: -95, y1: -28, x2: 12, y2: -28 },

        // --- VIEW 3: CROSS-SECTION B-B (centered around (54, 8)) ---
        { id: 'gs-v3-od-tip', viewId: 'view-cross-sec', featureId: 'feat-gs-gear', layer: 'outline', type: 'circle', cx: 54, cy: 8, r: 25 },
        { id: 'gs-v3-pitch', viewId: 'view-cross-sec', featureId: 'feat-gs-gear', layer: 'centerline', type: 'circle', cx: 54, cy: 8, r: 22.5 },
        { id: 'gs-v3-root', viewId: 'view-cross-sec', featureId: 'feat-gs-gear', layer: 'hidden', type: 'circle', cx: 54, cy: 8, r: 20 },
        { id: 'gs-v3-shaft', viewId: 'view-cross-sec', featureId: 'feat-gs-journals', layer: 'outline', type: 'circle', cx: 54, cy: 8, r: 12 },
        { id: 'gs-v3-bore', viewId: 'view-cross-sec', featureId: 'feat-gs-bore', layer: 'hole', type: 'circle', cx: 54, cy: 8, r: 6 },
        { id: 'gs-v3-clx', viewId: 'view-cross-sec', layer: 'centerline', type: 'line', x1: 24, y1: 8, x2: 84, y2: 8 },
        { id: 'gs-v3-cly', viewId: 'view-cross-sec', layer: 'centerline', type: 'line', x1: 54, y1: -22, x2: 54, y2: 38 },
      ],
      dimensions: [
        { id: 'dim-gs-len', viewId: 'view-ortho', featureId: 'feat-gs-journals', kind: 'linear', label: '96.00 ±0.05 (Ortho)', x1: -90, y1: 49, x2: 6, y2: 49, offset: 8 },
        { id: 'dim-gs-bore', viewId: 'view-long-sec', featureId: 'feat-gs-bore', kind: 'linear', label: 'Ø12.00 H7 Thru Bore (Sec A-A)', x1: -90, y1: -34, x2: -90, y2: -22, offset: -12 },
        { id: 'dim-gs-gear', viewId: 'view-cross-sec', featureId: 'feat-gs-gear', kind: 'diameter', label: '22T Mod 2.0 · Ø50.0 OD (Sec B-B)', x1: 54, y1: 8, x2: 79, y2: 26 },
      ],
      features: [
        {
          id: 'feat-gs-journals',
          name: 'Bearing Journals Ø20 g6 / Ø24 g6',
          category: 'grinding',
          dimensions: 'Ø20.00 g6 × 26 mm & Ø24.00 g6 × 30 mm',
          tolerance: '-0.007 / -0.020 mm (g6)',
          surfaceFinishRa: 'Ra 0.4 µm',
          notes: 'Leave +0.25 mm grinding allowance on Lathe before cylindrical grinding.',
        },
        {
          id: 'feat-gs-gear',
          name: 'Spur Gear 22 Teeth (Module 2.0)',
          category: 'gear',
          dimensions: '22T · Mod 2.0 · 20° PA · Ø44.0 PCD · 40.0 face',
          tolerance: 'DIN 7 gear quality',
          surfaceFinishRa: 'Ra 0.8 µm',
          notes: 'Hob between centers after turning blank OD to Ø48.00 mm.',
        },
        {
          id: 'feat-gs-bore',
          name: 'Internal Thru Bore Ø12 H7 (Section A-A)',
          category: 'bore',
          dimensions: 'Ø12.000 +0.018 / 0 mm × 96.0 mm thru',
          depthMm: 96,
          tolerance: 'H7 (+0.018 / 0)',
          surfaceFinishRa: 'Ra 0.8 µm',
          notes: 'Gun-drill & hone/bore internal coolant passage visible in Longitudinal Section.',
        },
        {
          id: 'feat-gs-keyway',
          name: 'Output Keyway 6×18 mm',
          category: 'slot',
          dimensions: '6.00 N9 wide × 18.0 mm long × 3.5 mm deep',
          depthMm: 3.5,
          tolerance: '±0.015 mm',
          surfaceFinishRa: 'Ra 1.6 µm',
          notes: 'Mill on VMC using V-block or live-tooling C-axis.',
        },
      ],
      processPlan: [
        {
          id: 'op-gs-10',
          opNumber: 10,
          operationName: 'Saw Ø58 mm 4140 Round Bar',
          machineType: 'Band Saw',
          setupName: 'OP-10: Bar Stock Prep',
          targetFeatureId: 'feat-gs-journals',
          targetFeatureName: 'Raw Bar Blank',
          toolSpec: 'Bi-Metal Blade 6/10 TPI',
          toolDiameterMm: 25,
          flutes: 1,
          spindleRpm: 155,
          feedRateMmMin: 42,
          depthOfCutMm: 58,
          coolant: 'Mist',
          setupTimeMin: 5,
          cycleTimeMin: 2.5,
          inspectionNote: 'Verify 132 mm cut length.',
        },
        {
          id: 'op-gs-20',
          opNumber: 20,
          operationName: 'Turn OD Steps & Drill Ø12 Thru Bore',
          machineType: 'Lathe Machine',
          setupName: 'OP-20: 3-Jaw Chuck + Tailstock',
          targetFeatureId: 'feat-gs-bore',
          targetFeatureName: 'Internal Thru Bore & OD Blank',
          toolSpec: 'CNMG 120408 + Ø11.8 Carbide Drill + Boring Bar',
          toolDiameterMm: 12,
          flutes: 2,
          spindleRpm: 1450,
          feedRateMmMin: 210,
          depthOfCutMm: 1.5,
          coolant: 'Flood',
          setupTimeMin: 18,
          cycleTimeMin: 5.4,
          inspectionNote: 'Leave +0.25 mm on Ø20/Ø24 journals for grinding.',
        },
        {
          id: 'op-gs-30',
          opNumber: 30,
          operationName: 'Hob 22-Tooth Mod 2.0 Spur Gear',
          machineType: 'Gear Hobbing',
          setupName: 'OP-30: Precision Expansion Mandrel',
          targetFeatureId: 'feat-gs-gear',
          targetFeatureName: 'Spur Gear 22 Teeth (Module 2.0)',
          toolSpec: 'Mod 2.0 20° PA TiN Coated Hob (Ø60 mm)',
          toolDiameterMm: 60,
          flutes: 12,
          spindleRpm: 320,
          feedRateMmMin: 65,
          depthOfCutMm: 4.5,
          coolant: 'Flood',
          setupTimeMin: 25,
          cycleTimeMin: 6.8,
          inspectionNote: 'Over-pin span M-value & tooth runout <= 0.02 mm.',
        },
        {
          id: 'op-gs-40',
          opNumber: 40,
          operationName: 'Mill 6×18 mm Output Keyway',
          machineType: 'Milling',
          setupName: 'OP-40: Indexing V-Block Fixture',
          targetFeatureId: 'feat-gs-keyway',
          targetFeatureName: 'Output Keyway 6×18 mm',
          toolSpec: 'Ø6 mm 4-Flute AlTiN Endmill',
          toolDiameterMm: 6,
          flutes: 4,
          spindleRpm: 4800,
          feedRateMmMin: 460,
          depthOfCutMm: 0.8,
          coolant: 'Flood',
          setupTimeMin: 14,
          cycleTimeMin: 2.1,
          inspectionNote: 'Verify 6.00 N9 slot width & symmetry.',
        },
        {
          id: 'op-gs-50',
          opNumber: 50,
          operationName: 'Cylindrical Grind Journals to Ø20/Ø24 g6',
          machineType: 'Grinding Finishing',
          setupName: 'OP-50: Between Dead Centers',
          targetFeatureId: 'feat-gs-journals',
          targetFeatureName: 'Bearing Journals Ø20 g6 / Ø24 g6',
          toolSpec: 'Ø300 mm 60-Grit CBN Cylindrical Wheel',
          toolDiameterMm: 300,
          flutes: 1,
          spindleRpm: 1900,
          feedRateMmMin: 160,
          depthOfCutMm: 0.015,
          coolant: 'Flood',
          setupTimeMin: 20,
          cycleTimeMin: 4.9,
          inspectionNote: 'Air-gauge g6 fit & profilometer Ra <= 0.4 µm.',
        },
      ],
      dfmNotes: [
        'Longitudinal Section A-A reveals the Ø12 H7 thru bore—bore/hone before hobbing so the mandrel locates cleanly on the finished ID.',
        'Cross-Section B-B specifies Mod 2.0 22T gear profile; leave +0.25 mm stock on Ø20/Ø24 bearing journals for post-hob Grinding Finishing.',
        'Add 1.5 mm grinding undercut reliefs at each bearing shoulder to ensure clean wheel clearance.',
      ],
      extractionSource: 'hybrid-pdf',
    },
  },
  {
    id: 'bearing-flange',
    title: 'Bearing Housing Flange',
    subtitle: '6061-T6 Aluminum · 120×120 mm · H7 Bore & 4× M6 Bolt Circle',
    fileName: 'Bearing_Housing_Flange_DWG104.pdf',
    analysis: {
      partName: 'Bearing Housing Flange',
      partNumber: 'DWG-104-A',
      revision: 'Rev B',
      units: 'mm',
      material: '6061-T6 Aluminum',
      stockEnvelope: {
        length: 126,
        width: 126,
        thickness: 22,
        form: 'Plate / Bar',
      },
      generalTolerance: 'ISO 2768-m (±0.1 mm)',
      surfaceFinishDefault: 'Ra 1.6 µm',
      boundingBox: { minX: -60, minY: -60, maxX: 60, maxY: 60 },
      entities: [
        {
          id: 'ent-outer-rect',
          featureId: 'feat-outer-profile',
          layer: 'outline',
          type: 'rect',
          x: -60,
          y: -60,
          width: 120,
          height: 120,
          rx: 12,
        },
        {
          id: 'ent-boss-circle',
          featureId: 'feat-boss-step',
          layer: 'outline',
          type: 'circle',
          cx: 0,
          cy: 0,
          r: 38,
        },
        {
          id: 'ent-center-bore',
          featureId: 'feat-center-bore',
          layer: 'hole',
          type: 'circle',
          cx: 0,
          cy: 0,
          r: 21,
        },
        {
          id: 'ent-keyway',
          featureId: 'feat-keyway',
          layer: 'outline',
          type: 'polyline',
          closed: false,
          points: [
            { x: -4, y: 20.6 },
            { x: -4, y: 24.5 },
            { x: 4, y: 24.5 },
            { x: 4, y: 20.6 },
          ],
        },
        {
          id: 'ent-bcd-circle',
          featureId: 'feat-bolt-holes',
          layer: 'centerline',
          type: 'circle',
          cx: 0,
          cy: 0,
          r: 44,
        },
        { id: 'ent-hole-1', featureId: 'feat-bolt-holes', layer: 'hole', type: 'circle', cx: 31.11, cy: 31.11, r: 3.3 },
        { id: 'ent-hole-2', featureId: 'feat-bolt-holes', layer: 'hole', type: 'circle', cx: -31.11, cy: 31.11, r: 3.3 },
        { id: 'ent-hole-3', featureId: 'feat-bolt-holes', layer: 'hole', type: 'circle', cx: -31.11, cy: -31.11, r: 3.3 },
        { id: 'ent-hole-4', featureId: 'feat-bolt-holes', layer: 'hole', type: 'circle', cx: 31.11, cy: -31.11, r: 3.3 },
        { id: 'ent-cl-x', layer: 'centerline', type: 'line', x1: -68, y1: 0, x2: 68, y2: 0 },
        { id: 'ent-cl-y', layer: 'centerline', type: 'line', x1: 0, y1: -68, x2: 0, y2: 68 },
      ],
      dimensions: [
        { id: 'dim-width', featureId: 'feat-outer-profile', kind: 'linear', label: '120.00 ±0.10', x1: -60, y1: -60, x2: 60, y2: -60, offset: -16 },
        { id: 'dim-height', featureId: 'feat-outer-profile', kind: 'linear', label: '120.00 ±0.10', x1: 60, y1: -60, x2: 60, y2: 60, offset: 16 },
        { id: 'dim-bore', featureId: 'feat-center-bore', kind: 'diameter', label: 'Ø42.00 H7 (+0.025/0)', x1: 0, y1: 0, x2: 21, y2: 0 },
        { id: 'dim-bcd', featureId: 'feat-bolt-holes', kind: 'diameter', label: '4× Ø6.6 THRU on Ø88.0 BCD', x1: 31.11, y1: 31.11, x2: 52, y2: 46 },
        { id: 'dim-boss', featureId: 'feat-boss-step', kind: 'diameter', label: 'Ø76.00 Boss · 6.0 Step', x1: 0, y1: 0, x2: -38, y2: 0 },
      ],
      features: [
        {
          id: 'feat-outer-profile',
          name: 'Outer Flange Profile (120×120 R12)',
          category: 'contour',
          dimensions: '120.0 × 120.0 × 18.0 mm, 4× R12 corners',
          depthMm: 18,
          tolerance: '±0.10 mm',
          surfaceFinishRa: 'Ra 1.6 µm',
          notes: 'Full perimeter profile with 0.5×45° edge break.',
        },
        {
          id: 'feat-boss-step',
          name: 'Raised Spigot Boss Ø76',
          category: 'turning',
          dimensions: 'Ø76.00 × 6.0 mm step height',
          depthMm: 6,
          tolerance: '±0.05 mm',
          surfaceFinishRa: 'Ra 0.8 µm',
          notes: 'Concentric to main bore within 0.03 mm.',
        },
        {
          id: 'feat-center-bore',
          name: 'Precision Bearing Bore Ø42 H7',
          category: 'bore',
          dimensions: 'Ø42.000 +0.025 / -0.000 mm THRU',
          depthMm: 18,
          tolerance: 'H7 (+0.025 / 0)',
          surfaceFinishRa: 'Ra 0.8 µm',
          notes: 'Finish bore with boring head or internal grind.',
        },
        {
          id: 'feat-keyway',
          name: 'Anti-Rotation Keyway 8×4 mm',
          category: 'slot',
          dimensions: '8.00 JS9 × 3.5 mm radial depth',
          depthMm: 18,
          tolerance: '±0.018 mm',
          surfaceFinishRa: 'Ra 1.6 µm',
          notes: 'Broach or slot after finish bore.',
        },
        {
          id: 'feat-bolt-holes',
          name: '4× M6 Clearance Bolt Circle',
          category: 'hole',
          dimensions: '4× Ø6.60 mm THRU on Ø88.0 BCD',
          depthMm: 18,
          tolerance: '±0.08 mm true pos',
          surfaceFinishRa: 'Ra 3.2 µm',
          notes: 'Spot drill + peck drill + 0.5×45° countersink.',
        },
      ],
      processPlan: [
        {
          id: 'op-10',
          opNumber: 10,
          operationName: 'Band Saw Blank Cut',
          machineType: 'Band Saw',
          setupName: 'OP-10: Bar Stock Prep',
          targetFeatureId: 'feat-outer-profile',
          targetFeatureName: 'Raw Stock Blank',
          toolSpec: 'Bi-Metal Blade 10/14 TPI',
          toolDiameterMm: 25,
          flutes: 1,
          spindleRpm: 210,
          feedRateMmMin: 95,
          depthOfCutMm: 22,
          coolant: 'Mist',
          setupTimeMin: 4,
          cycleTimeMin: 1.5,
          inspectionNote: 'Verify 126×126×22 mm billet size.',
        },
        {
          id: 'op-20',
          opNumber: 20,
          operationName: 'Face Mill Top Datum',
          machineType: 'Milling',
          setupName: 'OP-20: Soft Jaws G54',
          targetFeatureId: 'feat-boss-step',
          targetFeatureName: 'Top Datum Face',
          toolSpec: 'Ø50 mm 5-Flute Indexable Face Mill',
          toolDiameterMm: 50,
          flutes: 5,
          spindleRpm: 4200,
          feedRateMmMin: 2100,
          depthOfCutMm: 1.5,
          coolant: 'Flood',
          setupTimeMin: 15,
          cycleTimeMin: 1.2,
          inspectionNote: 'Flatness ≤ 0.02 mm across face.',
        },
        {
          id: 'op-30',
          opNumber: 30,
          operationName: 'Rough & Finish Outer Contour + Boss Step',
          machineType: 'Milling',
          setupName: 'OP-20: Soft Jaws G54',
          targetFeatureId: 'feat-outer-profile',
          targetFeatureName: 'Outer Flange Profile (120×120 R12)',
          toolSpec: 'Ø12 mm 3-Flute Polished Carbide Endmill',
          toolDiameterMm: 12,
          flutes: 3,
          spindleRpm: 9500,
          feedRateMmMin: 2400,
          depthOfCutMm: 4.5,
          coolant: 'Flood',
          setupTimeMin: 5,
          cycleTimeMin: 4.8,
          inspectionNote: 'Check 120.00 ±0.10 mm & Ø76.00 boss.',
        },
        {
          id: 'op-40',
          opNumber: 40,
          operationName: 'Helical Rough & Finish Bore Ø42 H7',
          machineType: 'Milling',
          setupName: 'OP-20: Soft Jaws G54',
          targetFeatureId: 'feat-center-bore',
          targetFeatureName: 'Precision Bearing Bore Ø42 H7',
          toolSpec: 'Ø10 mm 3-Flute Endmill + Ø42 Fine Boring Head',
          toolDiameterMm: 10,
          flutes: 3,
          spindleRpm: 3200,
          feedRateMmMin: 320,
          depthOfCutMm: 0.15,
          coolant: 'Flood',
          setupTimeMin: 10,
          cycleTimeMin: 3.4,
          inspectionNote: 'Go/No-Go plug gauge Ø42.000 / Ø42.025.',
        },
        {
          id: 'op-50',
          opNumber: 50,
          operationName: 'Spot & Peck Drill 4× Ø6.6 Bolt Circle',
          machineType: 'Milling',
          setupName: 'OP-20: Soft Jaws G54',
          targetFeatureId: 'feat-bolt-holes',
          targetFeatureName: '4× M6 Clearance Bolt Circle',
          toolSpec: 'Ø6.6 mm TiAlN Carbide Twist Drill',
          toolDiameterMm: 6.6,
          flutes: 2,
          spindleRpm: 5800,
          feedRateMmMin: 810,
          depthOfCutMm: 4.0,
          coolant: 'Flood',
          setupTimeMin: 5,
          cycleTimeMin: 1.6,
          inspectionNote: 'Pin gauge Ø6.60 mm + BCD check.',
        },
        {
          id: 'op-60',
          opNumber: 60,
          operationName: 'Surface Grind Mounting Face Flatness',
          machineType: 'Grinding Finishing',
          setupName: 'OP-30: Vacuum / Fixture Plate',
          targetFeatureId: 'feat-boss-step',
          targetFeatureName: 'Bottom & Spigot Datum Faces',
          toolSpec: 'Ø250 mm Silicon Carbide Grinding Wheel',
          toolDiameterMm: 250,
          flutes: 1,
          spindleRpm: 1850,
          feedRateMmMin: 220,
          depthOfCutMm: 0.02,
          coolant: 'Flood',
          setupTimeMin: 12,
          cycleTimeMin: 2.8,
          inspectionNote: 'Verify parallelism ≤ 0.015 mm & Ra 0.8 µm.',
        },
      ],
      dfmNotes: [
        'H7 bearing bore (Ø42.000/+0.025) requires single-point boring head pass after rough helical interpolation.',
        'Include 0.5 mm × 45° chamfer on bore entry to prevent bearing press-fit galling.',
        'Machine OP-20 outer contour, boss, bore, and 4× bolt holes in a single clamping to preserve concentricity.',
      ],
      extractionSource: 'hybrid-pdf',
    },
  },
  {
    id: 'l-bracket',
    title: 'L-Bracket Mounting Plate',
    subtitle: '304 Stainless Steel · 140×95 mm · Slotted Pocket & 2× M8',
    fileName: 'L_Bracket_Mounting_Plate_DWG209.pdf',
    analysis: {
      partName: 'L-Bracket Mounting Plate',
      partNumber: 'DWG-209-C',
      revision: 'Rev C',
      units: 'mm',
      material: '304 Stainless Steel',
      stockEnvelope: {
        length: 146,
        width: 102,
        thickness: 12,
        form: 'Plate / Bar',
      },
      generalTolerance: '±0.08 mm',
      surfaceFinishDefault: 'Ra 1.6 µm',
      boundingBox: { minX: -70, minY: -47.5, maxX: 70, maxY: 47.5 },
      entities: [
        {
          id: 'ent-lb-outer',
          featureId: 'feat-lb-profile',
          layer: 'outline',
          type: 'polyline',
          closed: true,
          points: [
            { x: -70, y: -47.5 },
            { x: 70, y: -47.5 },
            { x: 70, y: -2.5 },
            { x: -10, y: -2.5 },
            { x: -10, y: 47.5 },
            { x: -70, y: 47.5 },
          ],
        },
        {
          id: 'ent-lb-fillet',
          featureId: 'feat-lb-profile',
          layer: 'outline',
          type: 'arc',
          cx: -2,
          cy: 5.5,
          r: 8,
          startAngle: 180,
          endAngle: 270,
        },
        {
          id: 'ent-lb-slot-rect',
          featureId: 'feat-lb-slot',
          layer: 'hole',
          type: 'rect',
          x: 6,
          y: -32,
          width: 48,
          height: 14,
          rx: 7,
        },
        { id: 'ent-lb-slot-cl', featureId: 'feat-lb-slot', layer: 'centerline', type: 'line', x1: 0, y1: -25, x2: 60, y2: -25 },
        { id: 'ent-lb-h1', featureId: 'feat-lb-m8', layer: 'hole', type: 'circle', cx: -40, cy: 25, r: 4 },
        { id: 'ent-lb-h2', featureId: 'feat-lb-m8', layer: 'hole', type: 'circle', cx: -40, cy: -15, r: 4 },
        { id: 'ent-lb-h1-thd', featureId: 'feat-lb-m8', layer: 'hidden', type: 'circle', cx: -40, cy: 25, r: 5.0 },
        { id: 'ent-lb-h2-thd', featureId: 'feat-lb-m8', layer: 'hidden', type: 'circle', cx: -40, cy: -15, r: 5.0 },
        { id: 'ent-lb-cl-v', layer: 'centerline', type: 'line', x1: -40, y1: -30, x2: -40, y2: 38 },
      ],
      dimensions: [
        { id: 'dim-lb-len', featureId: 'feat-lb-profile', kind: 'linear', label: '140.00 ±0.08', x1: -70, y1: -47.5, x2: 70, y2: -47.5, offset: -15 },
        { id: 'dim-lb-ht', featureId: 'feat-lb-profile', kind: 'linear', label: '95.00 ±0.08', x1: -70, y1: -47.5, x2: -70, y2: 47.5, offset: -16 },
        { id: 'dim-lb-slot', featureId: 'feat-lb-slot', kind: 'linear', label: 'Slot 14.0 H9 × 48.0', x1: 6, y1: -18, x2: 54, y2: -18, offset: 12 },
        { id: 'dim-lb-m8', featureId: 'feat-lb-m8', kind: 'diameter', label: '2× M8×1.25 THRU', x1: -40, y1: 25, x2: -22, y2: 36 },
      ],
      features: [
        {
          id: 'feat-lb-profile',
          name: 'Stepped L-Bracket Perimeter (R8 Fillet)',
          category: 'contour',
          dimensions: '140.0 × 95.0 × 10.0 mm, R8 internal relief',
          depthMm: 10,
          tolerance: '±0.08 mm',
          surfaceFinishRa: 'Ra 1.6 µm',
          notes: 'Climb mill 304 SS with high-pressure flood coolant.',
        },
        {
          id: 'feat-lb-slot',
          name: 'Adjustment Slot 14×48 mm',
          category: 'slot',
          dimensions: '14.00 H9 width × 48.00 mm length THRU',
          depthMm: 10,
          tolerance: '+0.043 / 0 mm',
          surfaceFinishRa: 'Ra 1.6 µm',
          notes: 'Trochoidal slot roughing with Ø10 mm 5-flute endmill.',
        },
        {
          id: 'feat-lb-m8',
          name: '2× M8×1.25 Tapped Holes',
          category: 'thread',
          dimensions: '2× M8×1.25-6H THRU, 40.0 mm pitch',
          depthMm: 10,
          tolerance: '±0.05 mm pitch',
          surfaceFinishRa: 'Ra 3.2 µm',
          notes: 'Tap drill Ø6.8 mm + spiral-point tap.',
        },
      ],
      processPlan: [
        {
          id: 'op-lb-10',
          opNumber: 10,
          operationName: 'Waterjet / Saw Blank',
          machineType: 'Band Saw',
          setupName: 'OP-10: Plate Stock',
          targetFeatureId: 'feat-lb-profile',
          targetFeatureName: 'Raw 304 SS Plate',
          toolSpec: 'Carbide-Tipped Band Blade',
          toolDiameterMm: 25,
          flutes: 1,
          spindleRpm: 110,
          feedRateMmMin: 35,
          depthOfCutMm: 12,
          coolant: 'Flood',
          setupTimeMin: 6,
          cycleTimeMin: 3.2,
          inspectionNote: 'Verify 146×102×12 mm plate.',
        },
        {
          id: 'op-lb-20',
          opNumber: 20,
          operationName: 'Trochoidal Rough & Finish L-Contour',
          machineType: 'Milling',
          setupName: 'OP-20: Mitee-Bite Toe Clamps',
          targetFeatureId: 'feat-lb-profile',
          targetFeatureName: 'Stepped L-Bracket Perimeter (R8 Fillet)',
          toolSpec: 'Ø10 mm 5-Flute AlTiN Carbide Endmill',
          toolDiameterMm: 10,
          flutes: 5,
          spindleRpm: 3200,
          feedRateMmMin: 640,
          depthOfCutMm: 10.0,
          coolant: 'Flood',
          setupTimeMin: 18,
          cycleTimeMin: 7.5,
          inspectionNote: 'Check R8 internal fillet & 140.00 length.',
        },
        {
          id: 'op-lb-30',
          opNumber: 30,
          operationName: 'Slot Rough & Finish Pass (14 H9)',
          machineType: 'Milling',
          setupName: 'OP-20: Mitee-Bite Toe Clamps',
          targetFeatureId: 'feat-lb-slot',
          targetFeatureName: 'Adjustment Slot 14×48 mm',
          toolSpec: 'Ø10 mm 5-Flute AlTiN Carbide Endmill',
          toolDiameterMm: 10,
          flutes: 5,
          spindleRpm: 3100,
          feedRateMmMin: 560,
          depthOfCutMm: 3.5,
          coolant: 'Flood',
          setupTimeMin: 4,
          cycleTimeMin: 3.8,
          inspectionNote: 'Verify 14.00 +0.043/0 slot width.',
        },
        {
          id: 'op-lb-40',
          opNumber: 40,
          operationName: 'Drill Ø6.8 & Rigid Tap 2× M8×1.25',
          machineType: 'Milling',
          setupName: 'OP-20: Mitee-Bite Toe Clamps',
          targetFeatureId: 'feat-lb-m8',
          targetFeatureName: '2× M8×1.25 Tapped Holes',
          toolSpec: 'Ø6.8 mm Cobalt Drill + M8×1.25 Spiral Point Tap',
          toolDiameterMm: 6.8,
          flutes: 2,
          spindleRpm: 1650,
          feedRateMmMin: 210,
          depthOfCutMm: 2.5,
          coolant: 'Flood',
          setupTimeMin: 8,
          cycleTimeMin: 2.1,
          inspectionNote: 'M8-6H thread Go/No-Go gauge.',
        },
      ],
      dfmNotes: [
        '304 Stainless work-hardens rapidly: maintain constant chip load (≥ 0.04 mm/tooth) and avoid tool dwelling.',
        'R8 internal corner radius cleanly accommodates a Ø10 mm or Ø12 mm endmill without corner chatter.',
        'Consider laser/waterjet blanking for batch sizes > 50 pcs to cut roughing time by 45%.',
      ],
      extractionSource: 'hybrid-pdf',
    },
  },
  {
    id: 'stepped-shaft',
    title: 'Stepped Drive Shaft',
    subtitle: '4140 Alloy Steel · Ø40 × 150 mm · Turned Shoulders & M16 Thread',
    fileName: 'Stepped_Drive_Shaft_DWG312.pdf',
    analysis: {
      partName: 'Stepped Drive Shaft',
      partNumber: 'DWG-312-B',
      revision: 'Rev A',
      units: 'mm',
      material: '4140 Alloy Steel',
      stockEnvelope: {
        length: 156,
        width: 45,
        thickness: 45,
        form: 'Round Bar',
      },
      generalTolerance: 'ISO 2768-f (±0.05 mm)',
      surfaceFinishDefault: 'Ra 0.8 µm',
      boundingBox: { minX: 0, minY: -25, maxX: 150, maxY: 25 },
      entities: [
        {
          id: 'ent-sh-upper',
          featureId: 'feat-sh-od',
          layer: 'outline',
          type: 'polyline',
          closed: false,
          points: [
            { x: 0, y: 8 },
            { x: 28, y: 8 },
            { x: 28, y: 15 },
            { x: 65, y: 15 },
            { x: 65, y: 20 },
            { x: 112, y: 20 },
            { x: 112, y: 12.5 },
            { x: 150, y: 12.5 },
          ],
        },
        {
          id: 'ent-sh-lower',
          featureId: 'feat-sh-od',
          layer: 'outline',
          type: 'polyline',
          closed: false,
          points: [
            { x: 0, y: -8 },
            { x: 28, y: -8 },
            { x: 28, y: -15 },
            { x: 65, y: -15 },
            { x: 65, y: -20 },
            { x: 112, y: -20 },
            { x: 112, y: -12.5 },
            { x: 150, y: -12.5 },
          ],
        },
        { id: 'ent-sh-f0', featureId: 'feat-sh-od', layer: 'outline', type: 'line', x1: 0, y1: -8, x2: 0, y2: 8 },
        { id: 'ent-sh-f1', featureId: 'feat-sh-od', layer: 'outline', type: 'line', x1: 28, y1: -15, x2: 28, y2: 15 },
        { id: 'ent-sh-f2', featureId: 'feat-sh-od', layer: 'outline', type: 'line', x1: 65, y1: -20, x2: 65, y2: 20 },
        { id: 'ent-sh-f3', featureId: 'feat-sh-od', layer: 'outline', type: 'line', x1: 112, y1: -20, x2: 112, y2: 20 },
        { id: 'ent-sh-f4', featureId: 'feat-sh-od', layer: 'outline', type: 'line', x1: 150, y1: -12.5, x2: 150, y2: 12.5 },
        {
          id: 'ent-sh-groove',
          featureId: 'feat-sh-groove',
          layer: 'outline',
          type: 'rect',
          x: 124,
          y: -11.2,
          width: 2.2,
          height: 22.4,
        },
        { id: 'ent-sh-thd-1', featureId: 'feat-sh-thread', layer: 'hidden', type: 'line', x1: 0, y1: 6.7, x2: 25, y2: 6.7 },
        { id: 'ent-sh-thd-2', featureId: 'feat-sh-thread', layer: 'hidden', type: 'line', x1: 0, y1: -6.7, x2: 25, y2: -6.7 },
        { id: 'ent-sh-kw', featureId: 'feat-sh-keyway', layer: 'outline', type: 'rect', x: 75, y: -4, width: 27, height: 8, rx: 4 },
        { id: 'ent-sh-cl', layer: 'centerline', type: 'line', x1: -10, y1: 0, x2: 160, y2: 0 },
      ],
      dimensions: [
        { id: 'dim-sh-total', featureId: 'feat-sh-od', kind: 'linear', label: '150.00 ±0.05', x1: 0, y1: -20, x2: 150, y2: -20, offset: -14 },
        { id: 'dim-sh-od40', featureId: 'feat-sh-od', kind: 'linear', label: 'Ø40.00 k6', x1: 112, y1: -20, x2: 112, y2: 20, offset: 10 },
        { id: 'dim-sh-m16', featureId: 'feat-sh-thread', kind: 'linear', label: 'M16×1.5 × 25', x1: 0, y1: 8, x2: 25, y2: 8, offset: 14 },
        { id: 'dim-sh-kw', featureId: 'feat-sh-keyway', kind: 'linear', label: 'Keyway 8×27 mm', x1: 75, y1: 4, x2: 102, y2: 4, offset: 24 },
      ],
      features: [
        {
          id: 'feat-sh-od',
          name: 'Stepped Concentric OD Profile (Ø16 / Ø30 / Ø40 / Ø25)',
          category: 'turning',
          dimensions: 'Max Ø40.00 k6 × 150.00 mm overall',
          tolerance: '+0.018 / +0.002 mm (k6)',
          surfaceFinishRa: 'Ra 0.8 µm',
          notes: 'Turn between centers or chuck + live tailstock center.',
        },
        {
          id: 'feat-sh-thread',
          name: 'External Thread M16×1.5-6g',
          category: 'thread',
          dimensions: 'M16×1.5 × 25.0 mm length + thread relief',
          tolerance: '6g pitch class',
          surfaceFinishRa: 'Ra 1.6 µm',
          notes: 'Single-point CNC threading cycle G76.',
        },
        {
          id: 'feat-sh-groove',
          name: 'Retaining Ring Groove Ø22.4',
          category: 'groove',
          dimensions: '2.20 H13 wide × Ø22.40 h11 root',
          tolerance: '±0.05 mm',
          surfaceFinishRa: 'Ra 1.6 µm',
          notes: 'Plunge with 2.0 mm full-radius/square grooving insert.',
        },
        {
          id: 'feat-sh-keyway',
          name: 'Shaft Keyseat 8×27 mm',
          category: 'slot',
          dimensions: '8.00 N9 wide × 27.0 mm long × 4.0 mm deep',
          tolerance: '±0.018 mm',
          surfaceFinishRa: 'Ra 1.6 µm',
          notes: 'Mill on C-axis live tooling or secondary VMC V-block setup.',
        },
      ],
      processPlan: [
        {
          id: 'op-sh-10',
          opNumber: 10,
          operationName: 'Saw Ø45 mm Round Bar Stock',
          machineType: 'Band Saw',
          setupName: 'OP-10: Bar Cut',
          targetFeatureId: 'feat-sh-od',
          targetFeatureName: 'Ø45 × 156 mm Round Bar',
          toolSpec: 'Bi-Metal Blade 6/10 TPI',
          toolDiameterMm: 25,
          flutes: 1,
          spindleRpm: 160,
          feedRateMmMin: 45,
          depthOfCutMm: 45,
          coolant: 'Mist',
          setupTimeMin: 4,
          cycleTimeMin: 2.2,
          inspectionNote: 'Confirm 156 mm blank length.',
        },
        {
          id: 'op-sh-20',
          opNumber: 20,
          operationName: 'Face, Center Drill & Rough/Finish OD Steps',
          machineType: 'Lathe Machine',
          setupName: 'OP-20: 3-Jaw Chuck + Tailstock',
          targetFeatureId: 'feat-sh-od',
          targetFeatureName: 'Stepped Concentric OD Profile',
          toolSpec: 'CNMG 120408 Rough + VNMG 160404 Finish',
          toolDiameterMm: 12,
          flutes: 1,
          spindleRpm: 1600,
          feedRateMmMin: 240,
          depthOfCutMm: 1.5,
          coolant: 'Flood',
          setupTimeMin: 18,
          cycleTimeMin: 4.5,
          inspectionNote: 'Micrometer Ø40.00 k6 (+0.018/+0.002).',
        },
        {
          id: 'op-sh-30',
          opNumber: 30,
          operationName: 'Plunge Snap-Ring Groove (2.20 mm)',
          machineType: 'Lathe Machine',
          setupName: 'OP-20: 3-Jaw Chuck + Tailstock',
          targetFeatureId: 'feat-sh-groove',
          targetFeatureName: 'Retaining Ring Groove Ø22.4',
          toolSpec: '2.0 mm Carbide Grooving Insert',
          toolDiameterMm: 2,
          flutes: 1,
          spindleRpm: 950,
          feedRateMmMin: 60,
          depthOfCutMm: 1.3,
          coolant: 'Flood',
          setupTimeMin: 5,
          cycleTimeMin: 0.9,
          inspectionNote: 'Verify Ø22.40 root & 2.20 width.',
        },
        {
          id: 'op-sh-40',
          opNumber: 40,
          operationName: 'Single-Point M16×1.5 Thread (G76)',
          machineType: 'Lathe Machine',
          setupName: 'OP-20: 3-Jaw Chuck + Tailstock',
          targetFeatureId: 'feat-sh-thread',
          targetFeatureName: 'External Thread M16×1.5-6g',
          toolSpec: '60° Metric Partial Profile Thread Insert',
          toolDiameterMm: 16,
          flutes: 1,
          spindleRpm: 1100,
          feedRateMmMin: 1650,
          depthOfCutMm: 0.18,
          coolant: 'Flood',
          setupTimeMin: 6,
          cycleTimeMin: 1.1,
          inspectionNote: 'M16×1.5-6g ring gauge check.',
        },
        {
          id: 'op-sh-50',
          opNumber: 50,
          operationName: 'Mill 8×27 mm Keyway Seat',
          machineType: 'Milling',
          setupName: 'OP-30: Precision V-Block',
          targetFeatureId: 'feat-sh-keyway',
          targetFeatureName: 'Shaft Keyseat 8×27 mm',
          toolSpec: 'Ø8 mm 4-Flute TiAlN Carbide Endmill',
          toolDiameterMm: 8,
          flutes: 4,
          spindleRpm: 3800,
          feedRateMmMin: 420,
          depthOfCutMm: 1.0,
          coolant: 'Flood',
          setupTimeMin: 14,
          cycleTimeMin: 2.3,
          inspectionNote: 'Keyway width 8.00 N9 & concentricity.',
        },
        {
          id: 'op-sh-60',
          opNumber: 60,
          operationName: 'Cylindrical Finish Grind Ø40 k6 Journal',
          machineType: 'Grinding Finishing',
          setupName: 'OP-40: Grinding Centers',
          targetFeatureId: 'feat-sh-od',
          targetFeatureName: 'Ø40.00 k6 Bearing Shoulder',
          toolSpec: 'Ø300 mm 80-Grit CBN Wheel',
          toolDiameterMm: 300,
          flutes: 1,
          spindleRpm: 1950,
          feedRateMmMin: 150,
          depthOfCutMm: 0.015,
          coolant: 'Flood',
          setupTimeMin: 16,
          cycleTimeMin: 3.2,
          inspectionNote: 'Verify +0.018/+0.002 mm k6 & Ra 0.4 µm.',
        },
      ],
      dfmNotes: [
        'Use a 2.0 mm undercut relief at the back of the M16×1.5 thread to clear the threading insert exit.',
        'Specify R0.4 mm shoulder fillets where bearings seat to avoid stress concentration in 4140 steel.',
        'Use Grinding Finishing on the Ø40 k6 bearing shoulder after heat treat for optimal concentricity.',
      ],
      extractionSource: 'hybrid-pdf',
    },
  },
  {
    id: 'bend-pulley-shell',
    title: 'Bend Pulley Shell (SolidWorks PDF)',
    subtitle: 'M.S IS:2062 · Scale 1:20 · 3 Views · Ø440/Ø430 × 1000 mm',
    fileName: 'Shell_b55006b8.pdf',
    assetUrl: '/assets/aistudio/Shell_b55006b8.pdf',
    analysis: {
      partName: 'Bend Pulley Shell',
      partNumber: '04',
      revision: '00',
      units: 'mm',
      material: 'M.S IS:2062',
      stockEnvelope: {
        length: 1006,
        width: 446,
        thickness: 446,
        form: 'Tube',
      },
      generalTolerance: 'ISO 2768-m',
      surfaceFinishDefault: 'Ra 1.6 µm',
      boundingBox: { minX: -500, minY: -220, maxX: 500, maxY: 220 },
      entities: [],
      dimensions: [],
      features: [],
      processPlan: [],
      dfmNotes: [],
      extractionSource: 'pdf-vector',
      detectedScaleLabel: '1:20',
      detectedScaleFactor: 20,
    },
  },
];

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Generates a real, standards-compliant vector PDF (%PDF-1.4) for any preset.
 * When a preset has multiple viewChunks, each view is plotted in its own sheet region
 * with section labels so pdfjs-dist renders and auto-detects the multi-view chunks.
 */
export function generateSampleMechanicalPdfBytes(preset: SampleDrawingPreset): ArrayBuffer {
  const { analysis } = preset;
  // A4 Landscape: 842 x 595 pt
  const pageW = 842;
  const pageH = 595;
  const cmds: string[] = [];

  // Drawing sheet frame
  cmds.push('0.8 w 0.15 0.2 0.28 RG');
  cmds.push(`24 24 ${pageW - 48} ${pageH - 48} re S`);
  cmds.push('0.5 w');
  cmds.push(`30 30 ${pageW - 60} ${pageH - 60} re S`);

  // Title Block (bottom right)
  cmds.push('510 30 302 96 re S');
  cmds.push('510 62 m 812 62 l S');
  cmds.push('510 94 m 812 94 l S');
  cmds.push('670 30 m 670 94 l S');

  cmds.push('BT /F1 11 Tf 0.08 0.12 0.18 rg');
  cmds.push(`520 105 Td (${escapePdfText(analysis.partName)}) Tj ET`);
  cmds.push('BT /F1 8 Tf 0.25 0.32 0.40 rg');
  cmds.push(`520 75 Td (PART NO: ${escapePdfText(analysis.partNumber)}) Tj ET`);
  cmds.push(`680 75 Td (REV: ${escapePdfText(analysis.revision)}) Tj ET`);
  cmds.push(`520 44 Td (MAT: ${escapePdfText(analysis.material)}) Tj ET`);
  cmds.push(`680 44 Td (TOL: ${escapePdfText(analysis.generalTolerance)}) Tj ET`);

  // Header note
  cmds.push('BT /F1 9 Tf 0.25 0.32 0.40 rg');
  cmds.push(`42 544 Td (2D MECHANICAL ENGINEERING DRAWING  |  UNITS: ${analysis.units.toUpperCase()}  |  DEFAULT FINISH: ${escapePdfText(analysis.surfaceFinishDefault)}) Tj ET`);

  const hasChunks = analysis.viewChunks && analysis.viewChunks.length > 1;

  if (hasChunks && analysis.viewChunks) {
    for (const chunk of analysis.viewChunks) {
      const chunkEnts = analysis.entities.filter((e) => e.viewId === chunk.id);
      if (chunkEnts.length === 0) continue;

      let cMinX = Infinity;
      let cMinY = Infinity;
      let cMaxX = -Infinity;
      let cMaxY = -Infinity;
      for (const ent of chunkEnts) {
        if (ent.type === 'line') {
          cMinX = Math.min(cMinX, ent.x1, ent.x2);
          cMinY = Math.min(cMinY, ent.y1, ent.y2);
          cMaxX = Math.max(cMaxX, ent.x1, ent.x2);
          cMaxY = Math.max(cMaxY, ent.y1, ent.y2);
        } else if (ent.type === 'circle' || ent.type === 'arc') {
          cMinX = Math.min(cMinX, ent.cx - ent.r);
          cMinY = Math.min(cMinY, ent.cy - ent.r);
          cMaxX = Math.max(cMaxX, ent.cx + ent.r);
          cMaxY = Math.max(cMaxY, ent.cy + ent.r);
        } else if (ent.type === 'rect') {
          cMinX = Math.min(cMinX, ent.x);
          cMinY = Math.min(cMinY, ent.y);
          cMaxX = Math.max(cMaxX, ent.x + ent.width);
          cMaxY = Math.max(cMaxY, ent.y + ent.height);
        } else if (ent.type === 'polyline') {
          for (const p of ent.points) {
            cMinX = Math.min(cMinX, p.x);
            cMinY = Math.min(cMinY, p.y);
            cMaxX = Math.max(cMaxX, p.x);
            cMaxY = Math.max(cMaxY, p.y);
          }
        }
      }

      const b = chunk.normBounds;
      const boxLeft = b.x * pageW;
      const boxTop = pageH - b.y * pageH;
      const boxW = b.w * pageW;
      const boxH = b.h * pageH;
      const cx = boxLeft + boxW / 2;
      const cy = boxTop - boxH / 2;

      const spanX = Math.max(20, cMaxX - cMinX);
      const spanY = Math.max(20, cMaxY - cMinY);
      const scale = Math.min((boxW * 0.76) / spanX, (boxH * 0.68) / spanY);
      const midX = (cMinX + cMaxX) / 2;
      const midY = (cMinY + cMaxY) / 2;

      const toPdfX = (x: number) => (cx + (x - midX) * scale).toFixed(2);
      const toPdfY = (y: number) => (cy + (y - midY) * scale).toFixed(2);

      // View heading label inside the view box
      cmds.push('BT /F1 9 Tf 0.05 0.36 0.56 rg');
      cmds.push(`${(boxLeft + 10).toFixed(2)} ${(boxTop - 16).toFixed(2)} Td (${escapePdfText(chunk.label.toUpperCase())}) Tj ET`);

      for (const ent of chunkEnts) {
        if (ent.layer === 'centerline') {
          cmds.push('0.45 w [6 3 2 3] 0 d 0.45 0.55 0.68 RG');
        } else if (ent.layer === 'hidden') {
          cmds.push('0.6 w [4 3] 0 d 0.35 0.45 0.58 RG');
        } else {
          cmds.push('1.2 w [] 0 d 0.06 0.10 0.18 RG');
        }

        if (ent.type === 'line') {
          cmds.push(`${toPdfX(ent.x1)} ${toPdfY(ent.y1)} m ${toPdfX(ent.x2)} ${toPdfY(ent.y2)} l S`);
        } else if (ent.type === 'rect') {
          const rx = Number(toPdfX(ent.x));
          const ry = Number(toPdfY(ent.y));
          const rw = (ent.width * scale).toFixed(2);
          const rh = (ent.height * scale).toFixed(2);
          cmds.push(`${rx} ${ry} ${rw} ${rh} re S`);
        } else if (ent.type === 'circle') {
          const steps = 40;
          for (let i = 0; i <= steps; i++) {
            const ang = (i / steps) * Math.PI * 2;
            const px = toPdfX(ent.cx + ent.r * Math.cos(ang));
            const py = toPdfY(ent.cy + ent.r * Math.sin(ang));
            cmds.push(i === 0 ? `${px} ${py} m` : `${px} ${py} l`);
          }
          cmds.push('S');
        } else if (ent.type === 'polyline' && ent.points.length > 1) {
          ent.points.forEach((pt, idx) => {
            cmds.push(`${toPdfX(pt.x)} ${toPdfY(pt.y)} ${idx === 0 ? 'm' : 'l'}`);
          });
          cmds.push(ent.closed ? 'h S' : 'S');
        }
      }
    }
  } else {
    const cx = 390;
    const cy = 320;
    const bb = analysis.boundingBox;
    const spanX = Math.max(40, bb.maxX - bb.minX);
    const spanY = Math.max(40, bb.maxY - bb.minY);
    const scale = Math.min(360 / spanX, 260 / spanY);
    const midX = (bb.minX + bb.maxX) / 2;
    const midY = (bb.minY + bb.maxY) / 2;

    const toPdfX = (x: number) => (cx + (x - midX) * scale).toFixed(2);
    const toPdfY = (y: number) => (cy + (y - midY) * scale).toFixed(2);

    for (const ent of analysis.entities) {
      if (ent.layer === 'centerline') {
        cmds.push('0.45 w [6 3 2 3] 0 d 0.45 0.55 0.68 RG');
      } else if (ent.layer === 'hidden') {
        cmds.push('0.6 w [4 3] 0 d 0.35 0.45 0.58 RG');
      } else {
        cmds.push('1.25 w [] 0 d 0.06 0.10 0.18 RG');
      }

      if (ent.type === 'line') {
        cmds.push(`${toPdfX(ent.x1)} ${toPdfY(ent.y1)} m ${toPdfX(ent.x2)} ${toPdfY(ent.y2)} l S`);
      } else if (ent.type === 'rect') {
        const rx = Number(toPdfX(ent.x));
        const ry = Number(toPdfY(ent.y));
        const rw = (ent.width * scale).toFixed(2);
        const rh = (ent.height * scale).toFixed(2);
        cmds.push(`${rx} ${ry} ${rw} ${rh} re S`);
      } else if (ent.type === 'circle') {
        const steps = 40;
        for (let i = 0; i <= steps; i++) {
          const ang = (i / steps) * Math.PI * 2;
          const px = toPdfX(ent.cx + ent.r * Math.cos(ang));
          const py = toPdfY(ent.cy + ent.r * Math.sin(ang));
          cmds.push(i === 0 ? `${px} ${py} m` : `${px} ${py} l`);
        }
        cmds.push('S');
      } else if (ent.type === 'arc') {
        const steps = 20;
        const a0 = (ent.startAngle * Math.PI) / 180;
        const a1 = (ent.endAngle * Math.PI) / 180;
        for (let i = 0; i <= steps; i++) {
          const ang = a0 + ((a1 - a0) * i) / steps;
          const px = toPdfX(ent.cx + ent.r * Math.cos(ang));
          const py = toPdfY(ent.cy + ent.r * Math.sin(ang));
          cmds.push(i === 0 ? `${px} ${py} m` : `${px} ${py} l`);
        }
        cmds.push('S');
      } else if (ent.type === 'polyline' && ent.points.length > 1) {
        ent.points.forEach((pt, idx) => {
          cmds.push(`${toPdfX(pt.x)} ${toPdfY(pt.y)} ${idx === 0 ? 'm' : 'l'}`);
        });
        cmds.push(ent.closed ? 'h S' : 'S');
      }
    }

    cmds.push('[] 0 d 0.5 w 0.05 0.42 0.65 RG');
    for (const dim of analysis.dimensions) {
      const off = dim.offset ?? 0;
      const dx = dim.x2 - dim.x1;
      const dy = dim.y2 - dim.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * off;
      const ny = (dx / len) * off;
      const p1x = toPdfX(dim.x1 + nx);
      const p1y = toPdfY(dim.y1 + ny);
      const p2x = toPdfX(dim.x2 + nx);
      const p2y = toPdfY(dim.y2 + ny);
      if (dim.kind === 'linear') {
        cmds.push(`${toPdfX(dim.x1)} ${toPdfY(dim.y1)} m ${p1x} ${p1y} l S`);
        cmds.push(`${toPdfX(dim.x2)} ${toPdfY(dim.y2)} m ${p2x} ${p2y} l S`);
        cmds.push(`${p1x} ${p1y} m ${p2x} ${p2y} l S`);
      } else {
        cmds.push(`${toPdfX(dim.x1)} ${toPdfY(dim.y1)} m ${toPdfX(dim.x2)} ${toPdfY(dim.y2)} l S`);
      }
      const lx = ((Number(p1x) + Number(p2x)) / 2 - 24).toFixed(2);
      const ly = ((Number(p1y) + Number(p2y)) / 2 + 5).toFixed(2);
      cmds.push(`BT /F1 8 Tf 0.04 0.36 0.56 rg ${lx} ${ly} Td (${escapePdfText(dim.label)}) Tj ET`);
    }
  }

  const streamContent = cmds.join('\n');
  const encoder = new TextEncoder();
  const streamBytes = encoder.encode(streamContent);

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
  ];

  let pdfStr = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(encoder.encode(pdfStr).length);
    pdfStr += obj;
  }

  const xrefOffset = encoder.encode(pdfStr).length;
  pdfStr += `xref\n0 ${objects.length + 1}\n`;
  pdfStr += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdfStr += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdfStr += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return encoder.encode(pdfStr).buffer;
}
