import type {
  CadEntity,
  DrawingAnalysisResult,
  MachineCategory,
  MaterialMachiningPreset,
  ProcessOperation,
} from '../types/cad';

export const SHOP_MACHINES: MachineCategory[] = [
  'Lathe Machine',
  'Milling',
  'Grinding Finishing',
  'Gear Hobbing',
  'Band Saw',
  'Inspection',
];

export function normalizeMachineCategory(machineType: string): MachineCategory {
  const m = machineType.toLowerCase();
  if (m.includes('hob')) return 'Gear Hobbing';
  if (m.includes('grind')) return 'Grinding Finishing';
  if (m.includes('lathe') || m.includes('turn')) return 'Lathe Machine';
  if (m.includes('saw') || m.includes('cut')) return 'Band Saw';
  if (m.includes('inspect') || m.includes('cmm') || m.includes('qc')) return 'Inspection';
  return 'Milling';
}

export const MATERIAL_PRESETS: MaterialMachiningPreset[] = [
  {
    id: 'al-6061',
    name: '6061-T6 Aluminum',
    isoGroup: 'N',
    surfaceSpeedMMin: 260,
    chipLoadMmTooth: 0.08,
    densityGcm3: 2.70,
    costPerKgUsd: 7.5,
    machinabilityNote: 'High-speed milling with polished 3-flute carbide & flood/mist coolant.',
  },
  {
    id: 'ss-304',
    name: '304 Stainless Steel',
    isoGroup: 'M',
    surfaceSpeedMMin: 85,
    chipLoadMmTooth: 0.045,
    densityGcm3: 8.00,
    costPerKgUsd: 11.2,
    machinabilityNote: 'Work-hardens rapidly; maintain rigid setup, climb milling, and constant chip load.',
  },
  {
    id: 'steel-4140',
    name: '4140 Alloy Steel',
    isoGroup: 'P',
    surfaceSpeedMMin: 120,
    chipLoadMmTooth: 0.055,
    densityGcm3: 7.85,
    costPerKgUsd: 6.4,
    machinabilityNote: 'AlTiN coated carbide recommended; use flood coolant for turning, hobbing, and grinding.',
  },
  {
    id: 'brass-c360',
    name: 'C360 Free-Machining Brass',
    isoGroup: 'N',
    surfaceSpeedMMin: 220,
    chipLoadMmTooth: 0.075,
    densityGcm3: 8.50,
    costPerKgUsd: 13.8,
    machinabilityNote: 'Excellent chip breaking; zero-rake or light positive geometry prevents grabbing.',
  },
  {
    id: 'ms-is2062',
    name: 'M.S IS:2062 Mild Steel',
    isoGroup: 'P',
    surfaceSpeedMMin: 145,
    chipLoadMmTooth: 0.06,
    densityGcm3: 7.85,
    costPerKgUsd: 3.1,
    machinabilityNote: 'Structural mild steel (E250/IS:2062); use coated carbide inserts with flood coolant and chip-breaker geometry.',
  },
  {
    id: 'acetal-delrin',
    name: 'Acetal / Delrin (POM)',
    isoGroup: 'N',
    surfaceSpeedMMin: 300,
    chipLoadMmTooth: 0.11,
    densityGcm3: 1.41,
    costPerKgUsd: 9.0,
    machinabilityNote: 'Use razor-sharp O-flute/2-flute cutters and air blast to prevent thermal melting.',
  },
];

export function matchMaterialPreset(materialName: string): MaterialMachiningPreset {
  const lower = materialName.toLowerCase();
  if (lower.includes('304') || lower.includes('316') || lower.includes('stainless')) {
    return MATERIAL_PRESETS[1];
  }
  if (
    lower.includes('is:2062') ||
    lower.includes('is 2062') ||
    lower.includes('is2062') ||
    lower.includes('m.s') ||
    lower.includes('mild steel') ||
    /\bms\b/.test(lower)
  ) {
    return MATERIAL_PRESETS[4];
  }
  if (lower.includes('4140') || lower.includes('1045') || lower.includes('steel')) {
    return MATERIAL_PRESETS[2];
  }
  if (lower.includes('brass') || lower.includes('c360')) {
    return MATERIAL_PRESETS[3];
  }
  if (lower.includes('delrin') || lower.includes('acetal') || lower.includes('pom')) {
    return MATERIAL_PRESETS[5];
  }
  return MATERIAL_PRESETS[0];
}

export function calculateCuttingParams(
  preset: MaterialMachiningPreset,
  toolDiameterMm: number,
  flutes: number
): { spindleRpm: number; feedRateMmMin: number } {
  const safeD = Math.max(1, toolDiameterMm);
  const safeFlutes = Math.max(1, flutes);
  const rawRpm = (1000 * preset.surfaceSpeedMMin) / (Math.PI * safeD);
  const spindleRpm = Math.min(18000, Math.max(150, Math.round(rawRpm / 50) * 50));
  const feedRateMmMin = Math.max(
    40,
    Math.round((spindleRpm * safeFlutes * preset.chipLoadMmTooth) / 10) * 10
  );
  return { spindleRpm, feedRateMmMin };
}

export function getDefaultOperationTemplate(
  machine: MachineCategory,
  materialName: string,
  opNumber: number,
  targetFeatureName: string,
  targetFeatureId?: string
): ProcessOperation {
  const preset = matchMaterialPreset(materialName);
  const id = `op-${machine.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

  if (machine === 'Lathe Machine') {
    const rpm = preset.isoGroup === 'N' ? 2400 : 1450;
    return {
      id,
      opNumber,
      operationName: 'OD Turning & Boring Pass',
      machineType: 'Lathe Machine',
      setupName: `OP-${opNumber}: 3-Jaw Chuck + Live Center`,
      targetFeatureId,
      targetFeatureName,
      toolSpec: 'CNMG 120408 Rough + VNMG 160404 Finish',
      toolDiameterMm: 12,
      flutes: 1,
      spindleRpm: rpm,
      feedRateMmMin: preset.isoGroup === 'N' ? 320 : 210,
      depthOfCutMm: 1.5,
      coolant: 'Flood',
      setupTimeMin: 16,
      cycleTimeMin: 4.2,
      inspectionNote: 'Micrometer OD/ID step concentricity <= 0.02 mm.',
    };
  }

  if (machine === 'Grinding Finishing') {
    return {
      id,
      opNumber,
      operationName: 'Precision Cylindrical / Surface Grind',
      machineType: 'Grinding Finishing',
      setupName: `OP-${opNumber}: Grinding Centers / Magnetic Chuck`,
      targetFeatureId,
      targetFeatureName,
      toolSpec: 'Ø300 mm 60-Grit CBN / White AlOx Wheel',
      toolDiameterMm: 300,
      flutes: 1,
      spindleRpm: 1900,
      feedRateMmMin: 180,
      depthOfCutMm: 0.02,
      coolant: 'Flood',
      setupTimeMin: 18,
      cycleTimeMin: 5.5,
      inspectionNote: 'Profilometer Ra <= 0.4 µm & bore/journal IT6 check.',
    };
  }

  if (machine === 'Gear Hobbing') {
    const isSteel = preset.isoGroup === 'P' || preset.isoGroup === 'M';
    return {
      id,
      opNumber,
      operationName: 'Involute Gear / Spline Hobbing',
      machineType: 'Gear Hobbing',
      setupName: `OP-${opNumber}: Precision Mandrel & Tailstock`,
      targetFeatureId,
      targetFeatureName,
      toolSpec: 'Mod 2.0 20° PA TiN Coated HSS/Carbide Hob',
      toolDiameterMm: 60,
      flutes: 12,
      spindleRpm: isSteel ? 320 : 580,
      feedRateMmMin: isSteel ? 65 : 120,
      depthOfCutMm: 4.5,
      coolant: 'Flood',
      setupTimeMin: 24,
      cycleTimeMin: 6.8,
      inspectionNote: 'Over-pin M-dimension & double-flank gear roll check.',
    };
  }

  if (machine === 'Band Saw') {
    return {
      id,
      opNumber,
      operationName: 'Raw Stock Blank Sawing',
      machineType: 'Band Saw',
      setupName: `OP-${opNumber}: Bar Feeder Stop`,
      targetFeatureId,
      targetFeatureName,
      toolSpec: 'Bi-Metal Band Blade 8/12 TPI',
      toolDiameterMm: 25,
      flutes: 1,
      spindleRpm: 160,
      feedRateMmMin: 55,
      depthOfCutMm: 20,
      coolant: 'Mist',
      setupTimeMin: 4,
      cycleTimeMin: 1.8,
      inspectionNote: 'Verify +6 mm machining allowance.',
    };
  }

  if (machine === 'Inspection') {
    return {
      id,
      opNumber,
      operationName: 'CMM & GD&T Final Inspection',
      machineType: 'Inspection',
      setupName: `OP-${opNumber}: Granite Datum Plate`,
      targetFeatureId,
      targetFeatureName,
      toolSpec: 'Renishaw TP20 2 mm Ruby Stylus',
      toolDiameterMm: 2,
      flutes: 1,
      spindleRpm: 100,
      feedRateMmMin: 500,
      depthOfCutMm: 0.1,
      coolant: 'Dry',
      setupTimeMin: 8,
      cycleTimeMin: 3.0,
      inspectionNote: 'Record critical GD&T runout and bore tolerances.',
    };
  }

  // Default: Milling
  const { spindleRpm, feedRateMmMin } = calculateCuttingParams(preset, 10, 3);
  return {
    id,
    opNumber,
    operationName: '3-Axis Milling Profile / Feature',
    machineType: 'Milling',
    setupName: `OP-${opNumber}: Vise / Fixture G54`,
    targetFeatureId,
    targetFeatureName,
    toolSpec: 'Ø10 mm 3-Flute Solid Carbide Endmill',
    toolDiameterMm: 10,
    flutes: 3,
    spindleRpm,
    feedRateMmMin,
    depthOfCutMm: 2.5,
    coolant: 'Flood',
    setupTimeMin: 14,
    cycleTimeMin: 3.5,
    inspectionNote: 'Verify profile dimensions and edge chamfer.',
  };
}

export interface ToolpathSegment {
  opId: string;
  opNumber: number;
  kind: 'rapid' | 'cut';
  points: { x: number; y: number }[];
}

/**
 * Synthesizes visual 2D CAM toolpaths directly from plotted CAD entities
 * and the operation routing table.
 */
export function generateToolpathOverlay(
  analysis: DrawingAnalysisResult,
  activeOpId?: string | null,
  activeViewId?: string | null
): ToolpathSegment[] {
  const segments: ToolpathSegment[] = [];
  const bb = analysis.boundingBox;
  const home = { x: bb.minX - 18, y: bb.maxY + 18 };
  let cursor = { ...home };

  const ops = activeOpId
    ? analysis.processPlan.filter((op) => op.id === activeOpId)
    : analysis.processPlan;

  const isValidNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  const visibleEntities = activeViewId
    ? analysis.entities.filter((e) => !e.viewId || e.viewId === activeViewId)
    : analysis.entities;

  for (const op of ops) {
    const linked = visibleEntities.filter(
      (e) => e.featureId && op.targetFeatureId && e.featureId === op.targetFeatureId
    );
    const targetEntities: CadEntity[] =
      linked.length > 0
        ? linked
        : visibleEntities.filter((e) => e.layer === 'outline' || e.layer === 'hole').slice(0, 4);

    for (const ent of targetEntities) {
      if (ent.layer === 'centerline' || ent.layer === 'hidden') continue;

      if (ent.type === 'circle') {
        if (!isValidNum(ent.cx) || !isValidNum(ent.cy) || !isValidNum(ent.r) || ent.r <= 0) continue;
        const toolDia = isValidNum(op.toolDiameterMm) ? Math.min(op.toolDiameterMm, ent.r * 1.2) : 6;
        const offsetR = ent.layer === 'hole'
          ? Math.max(0.8, ent.r - toolDia * 0.3)
          : ent.r + toolDia * 0.35;
        const startPt = { x: ent.cx + offsetR, y: ent.cy };
        segments.push({
          opId: op.id,
          opNumber: op.opNumber,
          kind: 'rapid',
          points: [cursor, startPt],
        });
        const circlePts: { x: number; y: number }[] = [];
        for (let i = 0; i <= 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          circlePts.push({
            x: ent.cx + offsetR * Math.cos(a),
            y: ent.cy + offsetR * Math.sin(a),
          });
        }
        segments.push({
          opId: op.id,
          opNumber: op.opNumber,
          kind: 'cut',
          points: circlePts,
        });
        cursor = startPt;
      } else if (ent.type === 'rect') {
        if (
          !isValidNum(ent.x) ||
          !isValidNum(ent.y) ||
          !isValidNum(ent.width) ||
          !isValidNum(ent.height) ||
          ent.width <= 0 ||
          ent.height <= 0
        ) {
          continue;
        }
        const toolDia = isValidNum(op.toolDiameterMm) ? Math.min(op.toolDiameterMm, 12) : 6;
        const pad = ent.layer === 'hole' ? -Math.min(ent.width, ent.height) * 0.18 : toolDia * 0.4;
        const x0 = ent.x - pad;
        const y0 = ent.y - pad;
        const x1 = ent.x + ent.width + pad;
        const y1 = ent.y + ent.height + pad;
        const p0 = { x: x0, y: y0 };
        segments.push({
          opId: op.id,
          opNumber: op.opNumber,
          kind: 'rapid',
          points: [cursor, p0],
        });
        segments.push({
          opId: op.id,
          opNumber: op.opNumber,
          kind: 'cut',
          points: [p0, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, p0],
        });
        cursor = p0;
      } else if (ent.type === 'polyline' && ent.points.length > 1) {
        const validPts = ent.points.filter((p) => isValidNum(p.x) && isValidNum(p.y));
        if (validPts.length < 2) continue;
        segments.push({
          opId: op.id,
          opNumber: op.opNumber,
          kind: 'rapid',
          points: [cursor, validPts[0]],
        });
        const pts = ent.closed ? [...validPts, validPts[0]] : validPts;
        segments.push({
          opId: op.id,
          opNumber: op.opNumber,
          kind: 'cut',
          points: pts,
        });
        cursor = pts[pts.length - 1];
      } else if (ent.type === 'line') {
        if (!isValidNum(ent.x1) || !isValidNum(ent.y1) || !isValidNum(ent.x2) || !isValidNum(ent.y2)) {
          continue;
        }
        const p0 = { x: ent.x1, y: ent.y1 };
        const p1 = { x: ent.x2, y: ent.y2 };
        segments.push({
          opId: op.id,
          opNumber: op.opNumber,
          kind: 'rapid',
          points: [cursor, p0],
        });
        segments.push({
          opId: op.id,
          opNumber: op.opNumber,
          kind: 'cut',
          points: [p0, p1],
        });
        cursor = p1;
      }
    }
  }

  return segments;
}

export function exportToDxf(analysis: DrawingAnalysisResult): string {
  const lines: string[] = [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$INSUNITS',
    '70',
    analysis.units === 'in' ? '1' : '4',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
  ];

  const layerName = (l: string) => l.toUpperCase();

  for (const ent of analysis.entities) {
    const layer = layerName(ent.layer);
    if (ent.type === 'line') {
      lines.push('0', 'LINE', '8', layer, '10', ent.x1.toFixed(4), '20', ent.y1.toFixed(4), '30', '0.0', '11', ent.x2.toFixed(4), '21', ent.y2.toFixed(4), '31', '0.0');
    } else if (ent.type === 'circle') {
      lines.push('0', 'CIRCLE', '8', layer, '10', ent.cx.toFixed(4), '20', ent.cy.toFixed(4), '30', '0.0', '40', ent.r.toFixed(4));
    } else if (ent.type === 'arc') {
      lines.push('0', 'ARC', '8', layer, '10', ent.cx.toFixed(4), '20', ent.cy.toFixed(4), '30', '0.0', '40', ent.r.toFixed(4), '50', ent.startAngle.toFixed(2), '51', ent.endAngle.toFixed(2));
    } else if (ent.type === 'rect') {
      const pts = [
        [ent.x, ent.y],
        [ent.x + ent.width, ent.y],
        [ent.x + ent.width, ent.y + ent.height],
        [ent.x, ent.y + ent.height],
      ];
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        lines.push('0', 'LINE', '8', layer, '10', a[0].toFixed(4), '20', a[1].toFixed(4), '30', '0.0', '11', b[0].toFixed(4), '21', b[1].toFixed(4), '31', '0.0');
      }
    } else if (ent.type === 'polyline' && ent.points.length > 1) {
      const count = ent.closed ? ent.points.length : ent.points.length - 1;
      for (let i = 0; i < count; i++) {
        const a = ent.points[i];
        const b = ent.points[(i + 1) % ent.points.length];
        lines.push('0', 'LINE', '8', layer, '10', a.x.toFixed(4), '20', a.y.toFixed(4), '30', '0.0', '11', b.x.toFixed(4), '21', b.y.toFixed(4), '31', '0.0');
      }
    }
  }

  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}

export function exportToSvg(analysis: DrawingAnalysisResult): string {
  const bb = analysis.boundingBox;
  const pad = 20;
  const minX = bb.minX - pad;
  const minY = bb.minY - pad;
  const w = Math.max(40, bb.maxX - bb.minX + pad * 2);
  const h = Math.max(40, bb.maxY - bb.minY + pad * 2);

  const elements: string[] = [];
  for (const ent of analysis.entities) {
    const stroke =
      ent.layer === 'centerline'
        ? '#64748b'
        : ent.layer === 'hidden'
          ? '#94a3b8'
          : ent.layer === 'hole'
            ? '#0284c7'
            : '#0f172a';
    const dash =
      ent.layer === 'centerline'
        ? ' stroke-dasharray="6 3 2 3"'
        : ent.layer === 'hidden'
          ? ' stroke-dasharray="4 3"'
          : '';
    const sw = ent.layer === 'centerline' ? 0.35 : 0.7;

    if (ent.type === 'line') {
      elements.push(`<line x1="${ent.x1}" y1="${-ent.y1}" x2="${ent.x2}" y2="${-ent.y2}" stroke="${stroke}" stroke-width="${sw}"${dash} />`);
    } else if (ent.type === 'circle') {
      elements.push(`<circle cx="${ent.cx}" cy="${-ent.cy}" r="${ent.r}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash} />`);
    } else if (ent.type === 'rect') {
      elements.push(`<rect x="${ent.x}" y="${-(ent.y + ent.height)}" width="${ent.width}" height="${ent.height}" rx="${ent.rx || 0}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash} />`);
    } else if (ent.type === 'polyline' && ent.points.length > 1) {
      const pts = ent.points.map((p) => `${p.x},${-p.y}`).join(' ');
      const tag = ent.closed ? 'polygon' : 'polyline';
      elements.push(`<${tag} points="${pts}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash} />`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${-bb.maxY - pad} ${w} ${h}" width="${w}mm" height="${h}mm">
  <rect x="${minX}" y="${-bb.maxY - pad}" width="${w}" height="${h}" fill="#ffffff" />
  ${elements.join('\n  ')}
</svg>`;
}

export function exportToGcode(analysis: DrawingAnalysisResult): string {
  const lines: string[] = [
    `(${analysis.partName.toUpperCase()} - ${analysis.partNumber})`,
    `(MATERIAL: ${analysis.material})`,
    `(STOCK: ${analysis.stockEnvelope.length} x ${analysis.stockEnvelope.width} x ${analysis.stockEnvelope.thickness} MM)`,
    'G90 G21 G17 G40 G49 G80',
    'G54',
    '',
  ];

  const safeZ = 15.0;
  const toolpaths = generateToolpathOverlay(analysis);

  analysis.processPlan.forEach((op: ProcessOperation, idx: number) => {
    const toolNum = idx + 1;
    lines.push(`(OP-${op.opNumber} [${op.machineType}]: ${op.operationName} - ${op.toolSpec})`);
    lines.push(`T${String(toolNum).padStart(2, '0')} M06`);
    lines.push(`S${op.spindleRpm} M03`);
    lines.push(op.coolant === 'Flood' ? 'M08' : op.coolant === 'Mist' ? 'M07' : '(AIR/DRY)');

    const opSegs = toolpaths.filter((s) => s.opId === op.id);
    if (opSegs.length === 0) {
      lines.push(`G00 Z${safeZ.toFixed(3)}`);
      lines.push('(MANUAL / SECONDARY OPERATION)');
    } else {
      for (const seg of opSegs) {
        if (seg.points.length === 0) continue;
        if (seg.kind === 'rapid') {
          const target = seg.points[seg.points.length - 1];
          lines.push(`G00 Z${safeZ.toFixed(3)}`);
          lines.push(`G00 X${target.x.toFixed(3)} Y${target.y.toFixed(3)}`);
          lines.push(`G01 Z-${op.depthOfCutMm.toFixed(3)} F${Math.round(op.feedRateMmMin * 0.4)}`);
        } else {
          for (const pt of seg.points) {
            lines.push(`G01 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} F${op.feedRateMmMin}`);
          }
        }
      }
      lines.push(`G00 Z${safeZ.toFixed(3)}`);
    }
    lines.push('M09');
    lines.push('M05');
    lines.push('');
  });

  lines.push('G28 G91 Z0.');
  lines.push('G90');
  lines.push('M30');
  return lines.join('\n');
}

export function exportToProcessCsv(analysis: DrawingAnalysisResult, batchSize: number): string {
  const headers = [
    'Op #',
    'Operation Name',
    'Machine',
    'Setup',
    'Target Feature',
    'Tooling',
    'Tool Dia (mm)',
    'RPM',
    'Feed (mm/min)',
    'DOC (mm)',
    'Coolant',
    'Setup Time (min)',
    'Cycle Time/pc (min)',
    `Batch Total (${batchSize} pcs, min)`,
    'QC Inspection',
  ];

  const rows = analysis.processPlan.map((op) => [
    `OP-${op.opNumber}`,
    op.operationName,
    op.machineType,
    op.setupName,
    op.targetFeatureName,
    op.toolSpec,
    op.toolDiameterMm,
    op.spindleRpm,
    op.feedRateMmMin,
    op.depthOfCutMm,
    op.coolant,
    op.setupTimeMin,
    op.cycleTimeMin,
    (op.setupTimeMin + op.cycleTimeMin * batchSize).toFixed(1),
    op.inspectionNote,
  ]);

  const escapeCsv = (val: string | number) => {
    const str = String(val);
    return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
  };

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}
