import Anthropic from '@anthropic-ai/sdk';
import { type AgentEvent, SYSTEM_PROMPTS } from '@/lib/types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const maxDuration = 60;

// --- Herramientas de Wikipedia para el Researcher ---

async function searchWikipedia(query: string): Promise<{ title: string; snippet: string }[]> {
  const url = `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=5`;
  const res = await fetch(url, { headers: { 'User-Agent': 'AgenticDemo/1.0' } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.pages ?? []).map((p: { title: string; excerpt?: string }) => ({
    title: p.title,
    snippet: p.excerpt?.replace(/<[^>]+>/g, '') ?? '',
  }));
}

async function getWikipediaArticle(title: string): Promise<string> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'AgenticDemo/1.0' } });
  if (!res.ok) return `No se encontró el artículo: ${title}`;
  const data = await res.json();
  return data.extract ?? 'Artículo sin contenido.';
}

const RESEARCHER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_wikipedia',
    description: 'Searches Wikipedia for articles related to a query. Returns a list of matching article titles and snippets.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'The search query in English for best results' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_wikipedia_article',
    description: 'Retrieves the full summary of a specific Wikipedia article by its exact title.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'The exact Wikipedia article title to retrieve' },
      },
      required: ['title'],
    },
  },
];


export async function POST(req: Request) {
  const { question, supervisorModel, researcherModel, synthesizerModel } = await req.json();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        // ─────────────────────────────────────────────────────────
        // FASE 1 — El Supervisor analiza la pregunta
        // ─────────────────────────────────────────────────────────
        emit({
          type: 'supervisor_start',
          message: 'Recibí la pregunta del usuario. Voy a determinar qué investigar y en qué formato presentar la respuesta.',
        });

        const supervisorResponse = await client.messages.create({
          model: supervisorModel,
          max_tokens: 512,
          system: SYSTEM_PROMPTS.supervisor,
          messages: [{ role: 'user', content: question }],
        });

        const raw = supervisorResponse.content[0].type === 'text' ? supervisorResponse.content[0].text : '';
        let plan: { search_term: string; response_format: string };

        try {
          plan = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw);
        } catch {
          plan = { search_term: question, response_format: 'Explicación clara y estructurada' };
        }

        emit({
          type: 'supervisor_plan',
          searchTerm: plan.search_term,
          responseFormat: plan.response_format,
        });

        // El Supervisor delega al Researcher con instrucciones concretas
        const researcherInstruction = `Busca información sobre: "${plan.search_term}". Usa las herramientas disponibles para encontrar datos precisos en Wikipedia. Devuélveme un resumen completo de lo que encuentres.`;

        emit({
          type: 'supervisor_delegate',
          to: 'researcher',
          instructions: researcherInstruction,
        });

        // ─────────────────────────────────────────────────────────
        // FASE 2 — El Researcher busca información (bucle de herramientas)
        // ─────────────────────────────────────────────────────────
        emit({ type: 'researcher_start' });

        const researcherMessages: Anthropic.MessageParam[] = [
          {
            role: 'user',
            content: `${researcherInstruction}\n\nTema de investigación: "${plan.search_term}"`,
          },
        ];

        let researchSummary = '';
        let continueLoop = true;

        while (continueLoop) {
          const researcherResponse = await client.messages.create({
            model: researcherModel,
            max_tokens: 2048,
            system: SYSTEM_PROMPTS.researcher,
            tools: RESEARCHER_TOOLS,
            messages: researcherMessages,
          });

          for (const block of researcherResponse.content) {
            if (block.type === 'text' && block.text.trim()) {
              emit({ type: 'researcher_thinking', text: block.text });
            }
          }

          if (researcherResponse.stop_reason === 'tool_use') {
            const toolUseBlocks = researcherResponse.content.filter((b) => b.type === 'tool_use');
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const block of toolUseBlocks) {
              if (block.type !== 'tool_use') continue;

              emit({
                type: 'researcher_tool_call',
                tool: block.name,
                input: block.input as Record<string, string>,
              });

              let result: string;
              if (block.name === 'search_wikipedia') {
                const results = await searchWikipedia((block.input as { query: string }).query);
                result = results.length
                  ? results.map((r) => `• ${r.title}: ${r.snippet}`).join('\n')
                  : 'Sin resultados.';
                emit({
                  type: 'researcher_tool_result',
                  tool: block.name,
                  resultPreview: results.length ? results.map((r) => r.title).join(', ') : 'Sin resultados',
                  count: results.length,
                });
              } else if (block.name === 'get_wikipedia_article') {
                result = await getWikipediaArticle((block.input as { title: string }).title);
                emit({
                  type: 'researcher_tool_result',
                  tool: block.name,
                  resultPreview: result.length > 120 ? result.slice(0, 120) + '…' : result,
                });
              } else {
                result = 'Herramienta desconocida.';
                emit({ type: 'researcher_tool_result', tool: block.name, resultPreview: result });
              }

              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            }

            researcherMessages.push({ role: 'assistant', content: researcherResponse.content });
            researcherMessages.push({ role: 'user', content: toolResults });
          } else {
            const textBlock = researcherResponse.content.find((b) => b.type === 'text');
            researchSummary = textBlock?.type === 'text' ? textBlock.text : '';
            emit({ type: 'researcher_done' });
            continueLoop = false;
          }
        }

        // ─────────────────────────────────────────────────────────
        // FASE 3 — El Supervisor revisa y delega al Synthesizer
        // ─────────────────────────────────────────────────────────
        emit({
          type: 'supervisor_review',
          message: 'Recibí los hallazgos del Researcher. Ahora le paso los datos al Synthesizer para que construya la respuesta final.',
        });

        const synthesizerInstruction = `La pregunta del usuario es: "${question}". El formato de respuesta deseado es: ${plan.response_format}. Te envío los datos de investigación para que los estructures en una respuesta clara.`;

        emit({
          type: 'supervisor_delegate',
          to: 'synthesizer',
          instructions: synthesizerInstruction,
        });

        // ─────────────────────────────────────────────────────────
        // FASE 4 — El Synthesizer estructura la respuesta final
        // ─────────────────────────────────────────────────────────
        emit({ type: 'synthesizer_start' });

        const synthesizerResponse = await client.messages.create({
          model: synthesizerModel,
          max_tokens: 1500,
          system: SYSTEM_PROMPTS.synthesizer,
          messages: [
            {
              role: 'user',
              content: `${synthesizerInstruction}\n\nDatos de investigación:\n${researchSummary}`,
            },
          ],
        });

        const finalAnswer =
          synthesizerResponse.content[0].type === 'text' ? synthesizerResponse.content[0].text : '';

        emit({ type: 'synthesizer_done', answer: finalAnswer });

        // ─────────────────────────────────────────────────────────
        // FASE 5 — El Supervisor confirma la finalización
        // ─────────────────────────────────────────────────────────
        emit({ type: 'supervisor_done' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        emit({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
