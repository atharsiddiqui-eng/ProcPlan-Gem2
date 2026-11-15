import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '25mb' }));

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 90000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseImageDataUrl(raw: string): { mimeType: string; data: string } {
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return {
    mimeType: 'image/png',
    data: raw.replace(/^data:[^;]+;base64,/, ''),
  };
}

function formatErrDetail(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) {
    return `${err.message} (${cause.message})`;
  }
  return err.message;
}

function isTransientNetworkOrUpstreamError(err: unknown): boolean {
  const detail = formatErrDetail(err).toLowerCase();
  return (
    detail.includes('econnreset') ||
    detail.includes('etimedout') ||
    detail.includes('epipe') ||
    detail.includes('fetch failed') ||
    detail.includes('socket') ||
    detail.includes('network') ||
    detail.includes('429') ||
    detail.includes('502') ||
    detail.includes('503') ||
    detail.includes('504') ||
    detail.includes('unavailable')
  );
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  requestParams: Parameters<GoogleGenAI['models']['generateContent']>[0],
  maxAttempts = 3
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await ai.models.generateContent(requestParams);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && isTransientNetworkOrUpstreamError(err)) {
        const delayMs = 600 * Math.pow(2, attempt - 1);
        console.warn(
          `Gemini request transient failure (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms:`,
          formatErrDetail(err)
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

const drawingAnalysisSchema = {
  type: Type.OBJECT,
  properties: {
    partName: { type: Type.STRING, description: 'Part title from title block or inferred from geometry' },
    partNumber: { type: Type.STRING, description: 'Drawing or part number, e.g. DWG-1042' },
    revision: { type: Type.STRING, description: 'Revision code, e.g. A or Rev 2' },
    units: { type: Type.STRING, description: 'mm or in' },
    material: { type: Type.STRING, description: 'Material specification, e.g. 6061-T6 Aluminum' },
    stockEnvelope: {
      type: Type.OBJECT,
      properties: {
        length: { type: Type.NUMBER },
        width: { type: Type.NUMBER },
        thickness: { type: Type.NUMBER },
        form: { type: Type.STRING, description: 'Plate / Bar, Round Bar, or Tube' },
      },
      required: ['length', 'width', 'thickness', 'form'],
    },
    generalTolerance: { type: Type.STRING, description: 'e.g. ISO 2768-m or +/- 0.10 mm' },
    surfaceFinishDefault: { type: Type.STRING, description: 'e.g. Ra 1.6 um' },
    boundingBox: {
      type: Type.OBJECT,
      properties: {
        minX: { type: Type.NUMBER },
        minY: { type: Type.NUMBER },
        maxX: { type: Type.NUMBER },
        maxY: { type: Type.NUMBER },
      },
      required: ['minX', 'minY', 'maxX', 'maxY'],
    },
    viewChunks: {
      type: Type.ARRAY,
      description: 'Detected or user-adjusted PDF drawing views linked back to normalized sheet regions',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING },
          viewKind: { type: Type.STRING, description: 'orthogonal, longitudinal-section, cross-section, detail, or isometric' },
          pageNumber: { type: Type.INTEGER },
          normBounds: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              w: { type: Type.NUMBER },
              h: { type: Type.NUMBER },
            },
            required: ['x', 'y', 'w', 'h'],
          },
          sheetOffset: {
            type: Type.OBJECT,
            properties: {
              dx: { type: Type.NUMBER },
              dy: { type: Type.NUMBER },
            },
            required: ['dx', 'dy'],
          },
        },
        required: ['id', 'label', 'viewKind', 'pageNumber', 'normBounds', 'sheetOffset'],
      },
    },
    entities: {
      type: Type.ARRAY,
      description: '2D CAD entities plotted in real part coordinates (mm), tagged with viewId when multi-view',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          featureId: { type: Type.STRING },
          viewId: { type: Type.STRING, description: 'ID of the viewChunk this entity belongs to' },
          layer: { type: Type.STRING, description: 'outline, centerline, hidden, hole, or dimension' },
          type: { type: Type.STRING, description: 'line, circle, arc, rect, or polyline' },
          x1: { type: Type.NUMBER },
          y1: { type: Type.NUMBER },
          x2: { type: Type.NUMBER },
          y2: { type: Type.NUMBER },
          cx: { type: Type.NUMBER },
          cy: { type: Type.NUMBER },
          r: { type: Type.NUMBER },
          startAngle: { type: Type.NUMBER },
          endAngle: { type: Type.NUMBER },
          x: { type: Type.NUMBER },
          y: { type: Type.NUMBER },
          width: { type: Type.NUMBER },
          height: { type: Type.NUMBER },
          rx: { type: Type.NUMBER },
          closed: { type: Type.BOOLEAN },
          points: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
              },
              required: ['x', 'y'],
            },
          },
        },
        required: ['id', 'layer', 'type'],
      },
    },
    dimensions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          featureId: { type: Type.STRING },
          viewId: { type: Type.STRING, description: 'ID of the viewChunk this dimension belongs to' },
          kind: { type: Type.STRING, description: 'linear, diameter, radius, or note' },
          label: { type: Type.STRING },
          x1: { type: Type.NUMBER },
          y1: { type: Type.NUMBER },
          x2: { type: Type.NUMBER },
          y2: { type: Type.NUMBER },
          offset: { type: Type.NUMBER },
        },
        required: ['id', 'kind', 'label', 'x1', 'y1', 'x2', 'y2'],
      },
    },
    features: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          category: { type: Type.STRING, description: 'contour, bore, hole, pocket, slot, thread, chamfer, turning, groove, gear, or grinding' },
          dimensions: { type: Type.STRING },
          depthMm: { type: Type.NUMBER },
          tolerance: { type: Type.STRING },
          surfaceFinishRa: { type: Type.STRING },
          notes: { type: Type.STRING },
        },
        required: ['id', 'name', 'category', 'dimensions'],
      },
    },
    processPlan: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          opNumber: { type: Type.INTEGER },
          operationName: { type: Type.STRING },
          machineType: { type: Type.STRING, description: 'Use one of: Lathe Machine, Milling, Grinding Finishing, Gear Hobbing, Band Saw, Inspection' },
          setupName: { type: Type.STRING },
          targetFeatureId: { type: Type.STRING },
          targetFeatureName: { type: Type.STRING },
          toolSpec: { type: Type.STRING },
          toolDiameterMm: { type: Type.NUMBER },
          flutes: { type: Type.INTEGER },
          spindleRpm: { type: Type.INTEGER },
          feedRateMmMin: { type: Type.INTEGER },
          depthOfCutMm: { type: Type.NUMBER },
          coolant: { type: Type.STRING, description: 'Flood, Mist, Air Blast, or Dry' },
          setupTimeMin: { type: Type.NUMBER },
          cycleTimeMin: { type: Type.NUMBER },
          inspectionNote: { type: Type.STRING },
        },
        required: [
          'id',
          'opNumber',
          'operationName',
          'machineType',
          'setupName',
          'targetFeatureName',
          'toolSpec',
          'toolDiameterMm',
          'flutes',
          'spindleRpm',
          'feedRateMmMin',
          'depthOfCutMm',
          'coolant',
          'setupTimeMin',
          'cycleTimeMin',
          'inspectionNote',
        ],
      },
    },
    dfmNotes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    'partName',
    'partNumber',
    'revision',
    'units',
    'material',
    'stockEnvelope',
    'generalTolerance',
    'surfaceFinishDefault',
    'boundingBox',
    'entities',
    'dimensions',
    'features',
    'processPlan',
    'dfmNotes',
  ],
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
});

interface IncomingViewChunk {
  id: string;
  label: string;
  viewKind: string;
  pageNumber?: number;
  normBounds: { x: number; y: number; w: number; h: number };
  sheetOffset?: { dx: number; dy: number };
  croppedImageBase64?: string;
  extractedText?: string[];
  vectorSummary?: string;
}

app.post('/api/analyze-drawing', async (req, res) => {
  res.setTimeout(180000);
  try {
    const {
      fileName,
      pdfBase64,
      pageImageBase64,
      extractedText,
      vectorSummary,
      preferredMachine,
      preferredMachines,
      preferredMaterial,
      unitsOverride,
      modules,
      viewChunks,
    } = req.body as {
      fileName?: string;
      pdfBase64?: string;
      pageImageBase64?: string;
      extractedText?: string[];
      vectorSummary?: string;
      preferredMachine?: string;
      preferredMachines?: string[];
      preferredMaterial?: string;
      unitsOverride?: 'auto' | 'mm' | 'in';
      modules?: {
        cadPlotting?: boolean;
        processPlan?: boolean;
        toolingFeeds?: boolean;
      };
      viewChunks?: IncomingViewChunk[];
    };

    const includeCadPlotting = modules?.cadPlotting !== false;
    const includeProcessPlan = modules?.processPlan !== false;
    const includeToolingFeeds = modules?.toolingFeeds !== false;

    if (!pdfBase64 && !pageImageBase64) {
      res.status(400).json({ error: 'Missing PDF or rendered page image data.' });
      return;
    }

    const ai = getGeminiClient();

    type ContentPart =
      | { inlineData: { mimeType: string; data: string } }
      | { text: string };

    const parts: ContentPart[] = [];
    const slimParts: ContentPart[] = [];

    if (pdfBase64) {
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBase64,
        },
      });
    }
    if (pageImageBase64) {
      const parsedPageImg = parseImageDataUrl(pageImageBase64);
      const pageImgPart: ContentPart = { inlineData: parsedPageImg };
      parts.push(pageImgPart);
      slimParts.push(pageImgPart);
    }

    const hasChunks = Array.isArray(viewChunks) && viewChunks.length > 0;
    if (hasChunks) {
      const attachChunkImages = viewChunks.length > 1;
      for (const chunk of viewChunks.slice(0, 6)) {
        const chunkTextStr =
          chunk.extractedText && chunk.extractedText.length > 0
            ? chunk.extractedText.slice(0, 45).join(' | ')
            : 'none';
        const chunkMetaPart: ContentPart = {
          text: `[VIEW CHUNK] id="${chunk.id}" label="${chunk.label}" kind="${chunk.viewKind}" page=${chunk.pageNumber || 1} normBounds=${JSON.stringify(chunk.normBounds)} sheetOffset=${JSON.stringify(chunk.sheetOffset || { dx: 0, dy: 0 })} tokens="${chunkTextStr}" ${chunk.vectorSummary ? `vectors="${chunk.vectorSummary}"` : ''}`,
        };
        parts.push(chunkMetaPart);
        slimParts.push(chunkMetaPart);

        if (attachChunkImages && chunk.croppedImageBase64) {
          parts.push({
            inlineData: parseImageDataUrl(chunk.croppedImageBase64),
          });
        }
      }
    }

    const textContext = extractedText && extractedText.length > 0
      ? `Extracted PDF text tokens:\n${extractedText.slice(0, 120).join(' | ')}`
      : 'No embedded text layer found (likely scanned or outlined CAD).';

    const multiViewGuidance =
      hasChunks && viewChunks.length > 1
        ? `Multi-View Sheet Instructions:
- The PDF sheet has been partitioned into ${viewChunks.length} linked view chunks above (e.g. Orthogonal, Longitudinal Section, Cross-Section, Detail).
- Inspect EVERY individual view chunk image/text AND the complete original PDF sheet to cross-reference hidden/internal features (bores, keyways, step shoulders, gear teeth, section depths) with external profiles.
- Plot each view's 2D CAD geometry around its corresponding sheetOffset ({dx, dy}) in millimeters so all views appear cleanly separated on the Combined Sheet without overlapping, AND tag every entity and dimension with its exact matching viewId from [${viewChunks.map((c) => `"${c.id}"`).join(', ')}].
- Return the viewChunks array preserving each chunk's id, label, viewKind, pageNumber, normBounds, and sheetOffset.`
        : `Single/Primary View Instructions:
- Extract the primary orthographic view (and any secondary section details if visible) around datum (0,0) in millimeters.${
            hasChunks
              ? ` Tag entities with viewId="${viewChunks[0].id}" and return the viewChunks array.`
              : ''
          }`;

    const machineFocusLine =
      Array.isArray(preferredMachines) && preferredMachines.length > 0
        ? `Preferred shop equipment list: ${preferredMachines.join(', ')}`
        : preferredMachine
          ? `Preferred shop equipment focus: ${preferredMachine}`
          : '';

    const cadTaskText = includeCadPlotting
      ? `1. Read all views (Orthogonal, Longitudinal Section, Cross-Section, Detail) and extract accurate, proportional 2D CAD geometry in millimeters (convert inches to mm if drawing is in inches, while noting units). Include full numeric coordinates for each entity type: line (x1,y1,x2,y2), circle (cx,cy,r), arc (cx,cy,r,startAngle,endAngle), rect (x,y,width,height), or polyline (points:[{x,y}]).`
      : `1. CAD Plotting was skipped by user request: return empty arrays for entities ([]) and dimensions ([]), while still computing an accurate boundingBox and stockEnvelope in millimeters.`;

    const processTaskText = includeProcessPlan
      ? includeToolingFeeds
        ? `3. Generate a practical, ordered shop-floor CNC manufacturing process plan (OP-10, OP-20, ...) using exact machineType values from: "Lathe Machine", "Milling", "Grinding Finishing", "Gear Hobbing", "Band Saw", or "Inspection". Include realistic tooling, spindle RPM, feed rates (mm/min), depths of cut, setup time, cycle time, and inspection notes.`
        : `3. Generate a high-level shop-floor CNC operation sequence (OP-10, OP-20, ...) using exact machineType values from: "Lathe Machine", "Milling", "Grinding Finishing", "Gear Hobbing", "Band Saw", or "Inspection" with nominal placeholder tooling values (detailed feeds skipped by user).`
      : `3. Process Plan was skipped by user request: return an empty array for processPlan ([]).`;

    const promptText = `You are a senior mechanical engineer and CNC manufacturing process planner.
Analyze the attached 2D mechanical engineering drawing ("${fileName || 'drawing.pdf'}").
${textContext}
${vectorSummary ? `PDF vector geometry hint: ${vectorSummary}` : ''}
${preferredMaterial ? `Operator material override: ${preferredMaterial}` : ''}
${unitsOverride && unitsOverride !== 'auto' ? `Operator units preference: ${unitsOverride}` : ''}
${machineFocusLine}

${multiViewGuidance}

Tasks:
${cadTaskText}
2. Extract key tolerances, material, stock envelope (add realistic machining allowance over part bounds), and machined features synthesized from all views.${includeCadPlotting ? ' Also include linear/diameter/radius dimensions with finite x1,y1,x2,y2.' : ''}
${processTaskText}
4. Add 3 concise Design for Manufacturability (DFM) / multi-view setup observations.`;

    const promptPart: ContentPart = { text: promptText };
    parts.push(promptPart);
    slimParts.push(promptPart);

    const requestConfig = {
      systemInstruction:
        'Return strictly valid JSON adhering to the schema. Ensure CAD coordinates are mathematically consistent, finite, and cleanly linked to viewChunks via viewId.',
      responseMimeType: 'application/json',
      responseSchema: drawingAnalysisSchema,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
    };

    let response;
    try {
      response = await generateContentWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: requestConfig,
      });
    } catch (primaryErr) {
      if (
        isTransientNetworkOrUpstreamError(primaryErr) &&
        slimParts.length > 0 &&
        slimParts.length < parts.length
      ) {
        console.warn(
          'Primary multimodal payload failed with connection error; retrying with slim page-image payload:',
          formatErrDetail(primaryErr)
        );
        response = await generateContentWithRetry(
          ai,
          {
            model: 'gemini-4-hydrogen',
            contents: { parts: slimParts },
            config: requestConfig,
          },
          2
        );
      } else {
        throw primaryErr;
      }
    }

    const rawText = response.text?.trim();
    if (!rawText) {
      res.status(502).json({ error: 'Empty response from drawing analyzer.' });
      return;
    }

    const parsed = JSON.parse(rawText);
    const mergedViewChunks =
      Array.isArray(parsed.viewChunks) && parsed.viewChunks.length > 0
        ? parsed.viewChunks
        : hasChunks
          ? viewChunks.map((c) => ({
              id: c.id,
              label: c.label,
              viewKind: c.viewKind,
              pageNumber: c.pageNumber || 1,
              normBounds: c.normBounds,
              sheetOffset: c.sheetOffset || { dx: 0, dy: 0 },
            }))
          : undefined;

    res.json({
      ...parsed,
      material: preferredMaterial?.trim() || parsed.material,
      units: unitsOverride && unitsOverride !== 'auto' ? unitsOverride : parsed.units,
      entities: includeCadPlotting ? parsed.entities : [],
      dimensions: includeCadPlotting ? parsed.dimensions : [],
      processPlan: includeProcessPlan ? parsed.processPlan : [],
      viewChunks: mergedViewChunks,
      extractionSource: 'gemini-pdf',
    });
  } catch (err) {
    const message = formatErrDetail(err) || 'Failed to analyze drawing PDF.';
    console.error('Analyze drawing error:', err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/replan-process', async (req, res) => {
  try {
    const {
      partName,
      material,
      stockEnvelope,
      features,
      batchSize,
      shopMachineFocus,
      selectedMachines,
    } = req.body as {
      partName: string;
      material: string;
      stockEnvelope: { length: number; width: number; thickness: number; form: string };
      features: Array<{ id: string; name: string; category: string; dimensions: string; tolerance?: string }>;
      batchSize: number;
      shopMachineFocus: string;
      selectedMachines?: string[];
    };

    const ai = getGeminiClient();

    const replanSchema = {
      type: Type.OBJECT,
      properties: {
        processPlan: drawingAnalysisSchema.properties.processPlan,
        dfmNotes: drawingAnalysisSchema.properties.dfmNotes,
      },
      required: ['processPlan', 'dfmNotes'],
    };

    const machineConstraint =
      Array.isArray(selectedMachines) && selectedMachines.length > 0
        ? `Prioritize machineType assignments from: ${selectedMachines.join(', ')}.`
        : 'Assign each operation machineType using: "Lathe Machine", "Milling", "Grinding Finishing", "Gear Hobbing", "Band Saw", or "Inspection".';

    const response = await generateContentWithRetry(ai, {
      model: 'gemini-4-hydrogen',
      contents: `Regenerate an optimized CNC manufacturing process plan for:
Part: ${partName}
Material: ${material}
Stock: ${stockEnvelope.length} x ${stockEnvelope.width} x ${stockEnvelope.thickness} mm (${stockEnvelope.form})
Batch Quantity: ${batchSize} pcs
Shop Machine Strategy: ${shopMachineFocus}
${machineConstraint}
Features:
${features.map((f) => `- [${f.id}] ${f.name} (${f.category}): ${f.dimensions} ${f.tolerance ? `Tol: ${f.tolerance}` : ''}`).join('\n')}

Provide realistic OP-10, OP-20... steps tailored to batch quantity ${batchSize} and ${shopMachineFocus}, including accurate speeds/feeds for ${material}.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: replanSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim());
    res.json(parsed);
  } catch (err) {
    const message = formatErrDetail(err) || 'Failed to replan process.';
    console.error('Replan process error:', err);
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`DraftPlan CAD server listening on http://localhost:${PORT}`);
  });
  server.requestTimeout = 180000;
  server.headersTimeout = 185000;
}

startServer();
