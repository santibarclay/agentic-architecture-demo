'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { AgentEvent } from '@/lib/types';
import { SYSTEM_PROMPTS } from '@/lib/types';

// ─── Tipos locales ─────────────────────────────────────────────────────────────

type AgentStatus = 'esperando' | 'activo' | 'listo' | 'error';

type LogLine =
  | { kind: 'info'; text: string }
  | { kind: 'plan'; label: string; value: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_call'; tool: string; param: string }
  | { kind: 'tool_result'; preview: string; count?: number }
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string };

type HandoffMessage = {
  from: string;
  to: string;
  fromColor: string;
  toColor: string;
  instructions: string;
};

// ─── Constantes ────────────────────────────────────────────────────────────────

const MODELS = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', note: 'Máxima capacidad' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', note: 'Equilibrado' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', note: 'Más rápido' },
];

const EJEMPLOS = [
  '¿Qué es RAG (Retrieval Augmented Generation)?',
  '¿Cómo funcionan los transformers en inteligencia artificial?',
  '¿Qué es el aprendizaje por refuerzo?',
  '¿Cómo funciona la memoria en los modelos de lenguaje?',
];

const TOOL_LABELS: Record<string, string> = {
  search_wikipedia: 'Buscar en Wikipedia',
  get_wikipedia_article: 'Leer artículo de Wikipedia',
};

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function ModelSelector({
  label,
  value,
  onChange,
  disabled,
  accentClass,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  accentClass: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={`text-[10px] font-bold uppercase tracking-widest ${accentClass}`}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500 cursor-pointer disabled:opacity-50"
      >
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} — {m.note}
          </option>
        ))}
      </select>
    </div>
  );
}

function StatusBadge({ status }: { status: AgentStatus }) {
  if (status === 'esperando')
    return <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">En espera</span>;
  if (status === 'activo')
    return (
      <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-yellow-400">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
        Activo
      </span>
    );
  if (status === 'listo')
    return (
      <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
        Listo
      </span>
    );
  return <span className="text-[10px] text-red-400 font-medium uppercase tracking-wider">Error</span>;
}

function LogEntry({ line }: { line: LogLine }) {
  switch (line.kind) {
    case 'info':
      return <p className="text-gray-100 text-sm leading-relaxed">{line.text}</p>;

    case 'plan':
      return (
        <div className="flex gap-2 text-sm">
          <span className="text-gray-400 shrink-0">{line.label}:</span>
          <span className="text-white font-medium">{line.value}</span>
        </div>
      );

    case 'thinking':
      return (
        <p className="text-gray-400 text-xs italic leading-relaxed">
          {line.text.length > 150 ? line.text.slice(0, 150) + '…' : line.text}
        </p>
      );

    case 'tool_call':
      return (
        <div className="flex items-start gap-2 bg-gray-800 rounded-lg px-3 py-2 text-xs font-mono">
          <span className="text-yellow-400 shrink-0">⚡</span>
          <div>
            <span className="text-white font-semibold">{TOOL_LABELS[line.tool] ?? line.tool}</span>
            <span className="text-gray-400 ml-2">({line.param})</span>
          </div>
        </div>
      );

    case 'tool_result':
      return (
        <div className="pl-2 border-l-2 border-gray-700 text-xs text-gray-400 leading-relaxed">
          {line.count !== undefined && (
            <span className="text-gray-400">{line.count} resultado{line.count !== 1 ? 's' : ''}: </span>
          )}
          {line.preview}
        </div>
      );

    case 'success':
      return (
        <p className="text-green-400 text-sm font-medium flex items-center gap-1.5">
          <span>✓</span> {line.text}
        </p>
      );

    case 'error':
      return <p className="text-red-400 text-sm">{line.text}</p>;
  }
}

function AgentCard({
  icon,
  title,
  role,
  model,
  accentBorder,
  accentText,
  status,
  log,
  systemPromptSummary,
  knownAgents,
}: {
  icon: string;
  title: string;
  role: string;
  model: string;
  accentBorder: string;
  accentText: string;
  status: AgentStatus;
  log: LogLine[];
  systemPromptSummary: string;
  knownAgents?: string[];
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const modelLabel = MODELS.find((m) => m.id === model)?.label ?? model;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  return (
    <div
      className={`rounded-xl border-2 ${accentBorder} bg-gray-900 overflow-hidden transition-all duration-300 ${
        status === 'activo' ? 'shadow-lg' : 'opacity-80'
      } ${status === 'esperando' ? 'opacity-50' : ''}`}
    >
      {/* Cabecera del agente */}
      <div className="px-5 py-4 border-b border-gray-800">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{icon}</span>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className={`font-bold text-base ${accentText}`}>{title}</h3>
                <StatusBadge status={status} />
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{role}</p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Modelo</p>
            <p className="text-xs text-gray-400 mt-0.5">{modelLabel}</p>
          </div>
        </div>

        {/* Instrucciones del sistema — siempre visibles */}
        <details className="mt-3">
          <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-400 uppercase tracking-wider select-none">
            Ver instrucciones del sistema
          </summary>
          <div className="mt-2 bg-gray-800 rounded-lg px-3 py-2.5 text-[11px] text-gray-400 leading-relaxed font-mono whitespace-pre-wrap">
            {systemPromptSummary}
          </div>
        </details>

        {/* Sub-agentes conocidos (solo para el Supervisor) */}
        {knownAgents && (
          <div className="mt-3 flex gap-2 flex-wrap">
            <span className="text-[10px] text-gray-400 self-center">Conoce a:</span>
            {knownAgents.map((a) => (
              <span
                key={a}
                className="text-[10px] px-2 py-1 rounded-full bg-gray-800 border border-gray-700 text-gray-400"
              >
                {a}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Log de actividad */}
      <div
        ref={logRef}
        className="agent-log overflow-y-auto px-5 py-4 space-y-2.5 min-h-[80px] max-h-[220px]"
      >
        {log.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Esperando instrucciones…</p>
        ) : (
          log.map((line, i) => <LogEntry key={i} line={line} />)
        )}
      </div>
    </div>
  );
}

function HandoffArrow({
  from,
  to,
  fromColor,
  toColor,
  instructions,
  direction = 'down',
}: HandoffMessage & { direction?: 'down' | 'up-down' }) {
  return (
    <div className="flex flex-col items-center gap-0 my-1">
      {/* Línea vertical */}
      <div className="w-px h-4 bg-gray-700" />

      {/* Mensaje de traspaso */}
      <div className="w-full border border-gray-700 bg-gray-900 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-800/50">
          <span className={`text-xs font-bold ${fromColor}`}>{from}</span>
          <span className="text-gray-400 text-xs">→</span>
          <span className={`text-xs font-bold ${toColor}`}>{to}</span>
          <span className="ml-auto text-[10px] text-gray-400 uppercase tracking-wider">Instrucción</span>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-gray-100 leading-relaxed font-mono">{instructions}</p>
        </div>
      </div>

      {/* Línea vertical */}
      <div className="w-px h-4 bg-gray-700" />
    </div>
  );
}

// ─── Página principal ──────────────────────────────────────────────────────────

export default function Home() {
  const [question, setQuestion] = useState('');
  const [supervisorModel, setSupervisorModel] = useState('claude-sonnet-4-6');
  const [researcherModel, setResearcherModel] = useState('claude-sonnet-4-6');
  const [synthesizerModel, setSynthesizerModel] = useState('claude-sonnet-4-6');

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [finalAnswer, setFinalAnswer] = useState('');
  const [error, setError] = useState('');

  const [supervisorStatus, setSupervisorStatus] = useState<AgentStatus>('esperando');
  const [researcherStatus, setResearcherStatus] = useState<AgentStatus>('esperando');
  const [synthesizerStatus, setSynthesizerStatus] = useState<AgentStatus>('esperando');

  const [supervisorLog, setSupervisorLog] = useState<LogLine[]>([]);
  const [researcherLog, setResearcherLog] = useState<LogLine[]>([]);
  const [synthesizerLog, setSynthesizerLog] = useState<LogLine[]>([]);

  const [handoffToResearcher, setHandoffToResearcher] = useState<HandoffMessage | null>(null);
  const [handoffToSynthesizer, setHandoffToSynthesizer] = useState<HandoffMessage | null>(null);

  const reset = () => {
    setRunning(false);
    setDone(false);
    setFinalAnswer('');
    setError('');
    setSupervisorStatus('esperando');
    setResearcherStatus('esperando');
    setSynthesizerStatus('esperando');
    setSupervisorLog([]);
    setResearcherLog([]);
    setSynthesizerLog([]);
    setHandoffToResearcher(null);
    setHandoffToSynthesizer(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || running) return;

    reset();
    setRunning(true);
    setSupervisorStatus('activo');

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, supervisorModel, researcherModel, synthesizerModel }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Sin stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event: AgentEvent;
          try { event = JSON.parse(raw); } catch { continue; }

          switch (event.type) {
            case 'supervisor_start':
              setSupervisorLog((l) => [...l, { kind: 'info', text: event.message }]);
              break;

            case 'supervisor_plan':
              setSupervisorLog((l) => [
                ...l,
                { kind: 'plan', label: 'Término a investigar', value: event.searchTerm },
                { kind: 'plan', label: 'Formato de respuesta', value: event.responseFormat },
              ]);
              break;

            case 'supervisor_delegate':
              if (event.to === 'researcher') {
                setSupervisorLog((l) => [
                  ...l,
                  { kind: 'info', text: '→ Delegando tarea al Researcher...' },
                ]);
                setHandoffToResearcher({
                  from: 'Supervisor',
                  to: 'Researcher',
                  fromColor: 'text-purple-400',
                  toColor: 'text-emerald-400',
                  instructions: event.instructions,
                });
                setSupervisorStatus('listo');
                setResearcherStatus('activo');
              } else {
                setSupervisorLog((l) => [
                  ...l,
                  { kind: 'info', text: '→ Delegando síntesis al Synthesizer...' },
                ]);
                setHandoffToSynthesizer({
                  from: 'Supervisor',
                  to: 'Synthesizer',
                  fromColor: 'text-purple-400',
                  toColor: 'text-amber-400',
                  instructions: event.instructions,
                });
                setSynthesizerStatus('activo');
              }
              break;

            case 'supervisor_review':
              setSupervisorStatus('activo');
              setSupervisorLog((l) => [...l, { kind: 'info', text: event.message }]);
              break;

            case 'supervisor_done':
              setSupervisorStatus('listo');
              setSupervisorLog((l) => [...l, { kind: 'success', text: 'Pipeline completado con éxito.' }]);
              break;

            case 'researcher_start':
              setResearcherLog([{ kind: 'info', text: 'Iniciando investigación...' }]);
              break;

            case 'researcher_thinking':
              setResearcherLog((l) => [...l, { kind: 'thinking', text: event.text }]);
              break;

            case 'researcher_tool_call':
              setResearcherLog((l) => [
                ...l,
                {
                  kind: 'tool_call',
                  tool: event.tool,
                  param: event.input.query ?? event.input.title ?? '',
                },
              ]);
              break;

            case 'researcher_tool_result':
              setResearcherLog((l) => [
                ...l,
                { kind: 'tool_result', preview: event.resultPreview, count: event.count },
              ]);
              break;

            case 'researcher_done':
              setResearcherLog((l) => [...l, { kind: 'success', text: 'Investigación completada. Enviando hallazgos al Supervisor.' }]);
              setResearcherStatus('listo');
              setSupervisorStatus('activo');
              break;

            case 'synthesizer_start':
              setSynthesizerLog([{ kind: 'info', text: 'Estructurando la respuesta final...' }]);
              break;

            case 'synthesizer_done':
              setSynthesizerLog((l) => [...l, { kind: 'success', text: 'Síntesis completada.' }]);
              setSynthesizerStatus('listo');
              setFinalAnswer(event.answer);
              break;

            case 'error':
              setError(event.message);
              setSupervisorStatus((s) => s === 'activo' ? 'error' : s);
              setResearcherStatus((s) => s === 'activo' ? 'error' : s);
              setSynthesizerStatus((s) => s === 'activo' ? 'error' : s);
              break;
          }
        }
      }

      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setRunning(false);
    }
  };

  const pipelineVisible = running || done;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Cabecera */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-white tracking-tight">
              Demo de Arquitectura Agéntica
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Un supervisor coordina dos sub-agentes especializados en tiempo real
            </p>
          </div>
          <a
            href="https://github.com"
            className="text-xs text-gray-400 hover:text-gray-300 transition-colors border border-gray-800 px-3 py-1.5 rounded-lg"
          >
            GitHub
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8 flex flex-col gap-8">

        {/* ── Sección de entrada ── */}
        <section>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Escribe una pregunta sobre IA, tecnología o ciencia…"
              rows={3}
              disabled={running}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-gray-100 placeholder-gray-600 resize-none focus:outline-none focus:ring-1 focus:ring-gray-600 disabled:opacity-50 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSubmit(e as unknown as React.FormEvent);
                }
              }}
            />

            {/* Ejemplos */}
            <div className="flex flex-wrap gap-2">
              {EJEMPLOS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setQuestion(ex)}
                  disabled={running}
                  className="text-xs px-3 py-1.5 rounded-full border border-gray-700 text-gray-200 hover:border-gray-500 hover:text-white transition-colors disabled:opacity-40"
                >
                  {ex}
                </button>
              ))}
            </div>

            {/* Selectores de modelo */}
            <div className="grid grid-cols-3 gap-4 p-4 rounded-xl bg-gray-900 border border-gray-800">
              <ModelSelector
                label="Supervisor"
                value={supervisorModel}
                onChange={setSupervisorModel}
                disabled={running}
                accentClass="text-purple-400"
              />
              <ModelSelector
                label="Researcher"
                value={researcherModel}
                onChange={setResearcherModel}
                disabled={running}
                accentClass="text-emerald-400"
              />
              <ModelSelector
                label="Synthesizer"
                value={synthesizerModel}
                onChange={setSynthesizerModel}
                disabled={running}
                accentClass="text-amber-400"
              />
            </div>

            {/* Botones */}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!question.trim() || running}
                className="px-6 py-2.5 bg-white text-gray-900 font-semibold text-sm rounded-xl hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {running ? 'Investigando…' : 'Investigar'}
              </button>
              {(running || done) && (
                <button
                  type="button"
                  onClick={reset}
                  className="px-4 py-2.5 border border-gray-700 text-gray-400 text-sm rounded-xl hover:border-gray-600 hover:text-gray-200 transition-colors"
                >
                  Reiniciar
                </button>
              )}
            </div>
          </form>
        </section>

        {/* ── Cómo funciona (estado inicial) ── */}
        {!pipelineVisible && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-5">
              Cómo funciona
            </h2>
            <div className="flex flex-col gap-0">
              {/* Supervisor */}
              <div className="border border-gray-800 rounded-xl p-4 bg-gray-900">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="text-xl">🧠</span>
                  <span className="font-semibold text-purple-400">Supervisor</span>
                  <span className="ml-auto text-[10px] text-gray-400 uppercase tracking-wider">Agente orquestador</span>
                </div>
                <p className="text-sm text-gray-200 leading-relaxed">
                  Recibe tu pregunta, decide qué investigar y en qué formato presentar la respuesta.
                  Conoce a los dos sub-agentes disponibles y decide cuándo y cómo activarlos.
                </p>
              </div>

              {/* Flecha */}
              <div className="flex flex-col items-center py-1">
                <div className="w-px h-5 bg-gray-800" />
                <div className="text-gray-200 text-xs">delega tarea</div>
                <div className="w-px h-5 bg-gray-800" />
              </div>

              {/* Researcher */}
              <div className="border border-gray-800 rounded-xl p-4 bg-gray-900">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="text-xl">🔍</span>
                  <span className="font-semibold text-emerald-400">Researcher</span>
                  <span className="ml-auto text-[10px] text-gray-400 uppercase tracking-wider">Sub-agente con herramientas</span>
                </div>
                <p className="text-sm text-gray-200 leading-relaxed">
                  Usa herramientas reales para buscar en Wikipedia. Ejecuta un bucle autónomo:{' '}
                  <code className="text-xs bg-gray-800 text-emerald-400 px-1.5 py-0.5 rounded">search_wikipedia</code> →{' '}
                  <code className="text-xs bg-gray-800 text-emerald-400 px-1.5 py-0.5 rounded">get_wikipedia_article</code> → repite hasta tener suficiente información.
                </p>
              </div>

              {/* Flecha */}
              <div className="flex flex-col items-center py-1">
                <div className="w-px h-5 bg-gray-800" />
                <div className="text-gray-200 text-xs">devuelve hallazgos → supervisor delega síntesis</div>
                <div className="w-px h-5 bg-gray-800" />
              </div>

              {/* Synthesizer */}
              <div className="border border-gray-800 rounded-xl p-4 bg-gray-900">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="text-xl">✨</span>
                  <span className="font-semibold text-amber-400">Synthesizer</span>
                  <span className="ml-auto text-[10px] text-gray-400 uppercase tracking-wider">Sub-agente redactor</span>
                </div>
                <p className="text-sm text-gray-200 leading-relaxed">
                  Recibe los datos en bruto del Researcher (a través del Supervisor) y los convierte
                  en una respuesta clara y bien formateada en Markdown, adaptada al formato indicado.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ── Pipeline en vivo ── */}
        {pipelineVisible && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-5">
              Ejecución del pipeline
            </h2>

            <div className="flex flex-col">
              {/* SUPERVISOR */}
              <AgentCard
                icon="🧠"
                title="Supervisor"
                role="Analiza la pregunta y coordina a los sub-agentes"
                model={supervisorModel}
                accentBorder="border-purple-800"
                accentText="text-purple-400"
                status={supervisorStatus}
                log={supervisorLog}
                systemPromptSummary={SYSTEM_PROMPTS.supervisor}
                knownAgents={['🔍 Researcher', '✨ Synthesizer']}
              />

              {/* Handoff Supervisor → Researcher */}
              {handoffToResearcher && (
                <HandoffArrow {...handoffToResearcher} />
              )}
              {!handoffToResearcher && running && researcherStatus === 'esperando' && (
                <div className="flex flex-col items-center my-1">
                  <div className="w-px h-4 bg-gray-800" />
                  <div className="w-px h-4 bg-gray-800 animate-pulse" />
                </div>
              )}

              {/* RESEARCHER */}
              {(handoffToResearcher || researcherStatus !== 'esperando') && (
                <AgentCard
                  icon="🔍"
                  title="Researcher"
                  role="Busca información en Wikipedia usando herramientas"
                  model={researcherModel}
                  accentBorder="border-emerald-800"
                  accentText="text-emerald-400"
                  status={researcherStatus}
                  log={researcherLog}
                  systemPromptSummary={SYSTEM_PROMPTS.researcher}
                />
              )}

              {/* Handoff Supervisor → Synthesizer */}
              {handoffToSynthesizer && (
                <HandoffArrow {...handoffToSynthesizer} />
              )}

              {/* SYNTHESIZER */}
              {(handoffToSynthesizer || synthesizerStatus !== 'esperando') && (
                <AgentCard
                  icon="✨"
                  title="Synthesizer"
                  role="Convierte los datos en bruto en una respuesta clara"
                  model={synthesizerModel}
                  accentBorder="border-amber-800"
                  accentText="text-amber-400"
                  status={synthesizerStatus}
                  log={synthesizerLog}
                  systemPromptSummary={SYSTEM_PROMPTS.synthesizer}
                />
              )}
            </div>
          </section>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* ── Respuesta final ── */}
        {finalAnswer && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
              Respuesta final
            </h2>
            <div className="rounded-xl border border-gray-700 bg-gray-900 px-6 py-5">
              <div className="markdown">
                <ReactMarkdown>{finalAnswer}</ReactMarkdown>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Pie de página */}
      <footer className="border-t border-gray-800 px-6 py-4 text-center">
        <p className="text-xs text-gray-400">
          Open source · Next.js + API de Claude ·{' '}
          <a href="https://docs.anthropic.com" className="hover:text-gray-400 transition-colors underline">
            Documentación de Anthropic
          </a>
        </p>
      </footer>
    </div>
  );
}
