// Tipos de eventos emitidos por el pipeline de agentes vía SSE
export type AgentEvent =
  // Supervisor
  | { type: 'supervisor_start'; message: string }
  | { type: 'supervisor_plan'; searchTerm: string; responseFormat: string }
  | { type: 'supervisor_delegate'; to: 'researcher' | 'synthesizer'; instructions: string }
  | { type: 'supervisor_review'; message: string }
  | { type: 'supervisor_done' }
  // Researcher
  | { type: 'researcher_start' }
  | { type: 'researcher_thinking'; text: string }
  | { type: 'researcher_tool_call'; tool: string; input: Record<string, string> }
  | { type: 'researcher_tool_result'; tool: string; resultPreview: string; count?: number }
  | { type: 'researcher_done' }
  // Synthesizer
  | { type: 'synthesizer_start' }
  | { type: 'synthesizer_done'; answer: string }
  // Error
  | { type: 'error'; message: string };

// Instrucciones del sistema para cada agente — expuestas para mostrar en el UI
export const SYSTEM_PROMPTS = {
  supervisor: `Eres un agente supervisor que coordina un equipo de investigación.
Tu equipo está compuesto por:
- Agente Researcher: busca información en Wikipedia usando herramientas
- Agente Synthesizer: estructura la información en una respuesta clara

Tu trabajo: analizar la pregunta del usuario y producir un plan de investigación.
Responde ÚNICAMENTE con un objeto JSON válido, sin markdown ni explicaciones.
Ejemplo: {"search_term": "Retrieval Augmented Generation", "response_format": "Explicar el concepto, sus componentes principales, beneficios y un ejemplo práctico"}`,

  researcher: `Eres un agente investigador. Tu trabajo es encontrar información precisa usando Wikipedia.
Usa la herramienta search_wikipedia para encontrar artículos relevantes, luego get_wikipedia_article para obtener el contenido completo.
Sé exhaustivo: busca, lee artículos y recopila suficiente información para responder bien la pregunta.
Cuando tengas suficiente información, proporciona un resumen completo de tus hallazgos.`,

  synthesizer: `Eres un agente de síntesis. Recibes investigación en bruto y produces una respuesta clara y bien estructurada.
Formatea tu respuesta usando Markdown (encabezados, viñetas, negrita donde corresponda).
Sé conciso pero completo. Responde en el mismo idioma que la pregunta del usuario.`,
};
