import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const maxDuration = 60;

// --- Wikipedia helpers ---

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

// --- Tool definitions for Researcher ---

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

// --- Event emitter helper ---

type AgentEvent =
  | { type: 'supervisor_start'; message: string }
  | { type: 'supervisor_plan'; searchTerm: string; responseFormat: string; raw: string }
  | { type: 'supervisor_delegate'; instructions: string }
  | { type: 'researcher_start' }
  | { type: 'researcher_thinking'; text: string }
  | { type: 'researcher_tool_call'; tool: string; input: Record<string, string> }
  | { type: 'researcher_tool_result'; tool: string; result: string }
  | { type: 'researcher_done'; summary: string }
  | { type: 'synthesizer_start' }
  | { type: 'synthesizer_done'; answer: string }
  | { type: 'supervisor_done' }
  | { type: 'error'; message: string };

export async function POST(req: Request) {
  const { question, supervisorModel, researcherModel, synthesizerModel } = await req.json();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        // ─────────────────────────────────────────
        // PHASE 1 — Supervisor analyzes the question
        // ─────────────────────────────────────────
        emit({ type: 'supervisor_start', message: 'Analizando la pregunta y planificando la investigación...' });

        const supervisorResponse = await client.messages.create({
          model: supervisorModel,
          max_tokens: 512,
          system: `You are a supervisor agent coordinating a research pipeline.
Your team consists of:
- Researcher Agent: searches Wikipedia using tools
- Synthesizer Agent: structures information into a clear answer

Your job: analyze the user's question and produce a research plan.
Respond ONLY with a valid JSON object — no markdown, no explanation. Example:
{"search_term": "Retrieval Augmented Generation", "response_format": "Explain the concept, its main components, benefits, and a practical example"}`,
          messages: [{ role: 'user', content: question }],
        });

        const raw = supervisorResponse.content[0].type === 'text' ? supervisorResponse.content[0].text : '';
        let plan: { search_term: string; response_format: string };

        try {
          plan = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw);
        } catch {
          plan = { search_term: question, response_format: 'Clear and structured explanation' };
        }

        emit({
          type: 'supervisor_plan',
          searchTerm: plan.search_term,
          responseFormat: plan.response_format,
          raw,
        });

        emit({
          type: 'supervisor_delegate',
          instructions: `Busca información sobre: "${plan.search_term}". Usa las herramientas disponibles para encontrar datos precisos en Wikipedia.`,
        });

        // ─────────────────────────────────────────
        // PHASE 2 — Researcher agent (tool use loop)
        // ─────────────────────────────────────────
        emit({ type: 'researcher_start' });

        const researcherMessages: Anthropic.MessageParam[] = [
          {
            role: 'user',
            content: `Research the following topic thoroughly using Wikipedia tools: "${plan.search_term}"
After gathering enough information, provide a comprehensive summary of your findings.`,
          },
        ];

        let researchSummary = '';
        let continueLoop = true;

        while (continueLoop) {
          const researcherResponse = await client.messages.create({
            model: researcherModel,
            max_tokens: 2048,
            system: `You are a research agent. Your job is to find accurate information using Wikipedia.
Use the search_wikipedia tool to find relevant articles, then get_wikipedia_article to retrieve full content.
Be thorough: search, read articles, and gather enough information to answer the research question well.
When you have enough information, provide a comprehensive summary of your findings.`,
            tools: RESEARCHER_TOOLS,
            messages: researcherMessages,
          });

          // Collect text content as thinking
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
                  : 'No results found.';
              } else if (block.name === 'get_wikipedia_article') {
                result = await getWikipediaArticle((block.input as { title: string }).title);
              } else {
                result = 'Unknown tool.';
              }

              emit({
                type: 'researcher_tool_result',
                tool: block.name,
                result: result.length > 300 ? result.slice(0, 300) + '…' : result,
              });

              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            }

            researcherMessages.push({ role: 'assistant', content: researcherResponse.content });
            researcherMessages.push({ role: 'user', content: toolResults });
          } else {
            // end_turn — researcher is done
            const textBlock = researcherResponse.content.find((b) => b.type === 'text');
            researchSummary = textBlock?.type === 'text' ? textBlock.text : '';
            emit({ type: 'researcher_done', summary: researchSummary });
            continueLoop = false;
          }
        }

        // ─────────────────────────────────────────
        // PHASE 3 — Synthesizer structures the answer
        // ─────────────────────────────────────────
        emit({ type: 'synthesizer_start' });

        const synthesizerResponse = await client.messages.create({
          model: synthesizerModel,
          max_tokens: 1500,
          system: `You are a synthesis agent. You receive raw research and produce a clear, well-structured answer.
Format your response using Markdown (headers, bullet points, bold text where appropriate).
Be concise but complete. Answer in the same language as the user's question.`,
          messages: [
            {
              role: 'user',
              content: `User's question: "${question}"

Research findings:
${researchSummary}

Desired format: ${plan.response_format}

Write a clear, well-structured answer in Markdown.`,
            },
          ],
        });

        const finalAnswer =
          synthesizerResponse.content[0].type === 'text' ? synthesizerResponse.content[0].text : '';

        emit({ type: 'synthesizer_done', answer: finalAnswer });

        // ─────────────────────────────────────────
        // PHASE 4 — Supervisor confirms completion
        // ─────────────────────────────────────────
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
