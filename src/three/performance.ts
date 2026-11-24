const loaderPerformanceFlag = "__THREE_MMD_LOADER_PERF__";

let loaderProfileId = 0;

interface LoaderPerformanceGlobal {
  [loaderPerformanceFlag]?: boolean;
}

export interface LoaderPerformanceMeasure {
  readonly label: string;
  readonly name: string;
  readonly durationMs: number;
}

export interface LoaderPerformanceOptions {
  readonly enabled?: boolean;
  readonly onMeasure?: (measure: LoaderPerformanceMeasure) => void;
}

interface LoaderPerformanceProfile {
  readonly measures: readonly LoaderPerformanceMeasure[];
  mark(name: string): void;
  measure(name: string, start: string, end: string): void;
  clear(): void;
}

export function createLoaderPerformanceProfile(
  label: string,
  options: LoaderPerformanceOptions = {}
): LoaderPerformanceProfile | undefined {
  // Private local files: callback-only measurements never enter User Timing.
  if (options.enabled === false && options.onMeasure) {
    const times = new Map<string, number>();
    return {
      measures: [],
      mark(name) { times.set(name, performance.now()); },
      measure(name, start, end) {
        const a = times.get(start), b = times.get(end);
        if (a !== undefined && b !== undefined) options.onMeasure?.({ label: "model", name, durationMs: b - a });
      },
      clear() { times.clear(); }
    };
  }
  if (!isLoaderPerformanceEnabled(options)) {
    return undefined;
  }

  const profileId = ++loaderProfileId;
  const prefix = `three-mmd-loader:${profileId}:${sanitizePerformanceLabel(label)}`;
  const marks = new Set<string>();
  const measures: LoaderPerformanceMeasure[] = [];

  return {
    measures,
    mark(name: string): void {
      const markName = `${prefix}:${name}`;
      performance.mark(markName);
      marks.add(markName);
    },
    measure(name: string, start: string, end: string): void {
      const measureName = `${prefix}:${name}`;
      const startMark = `${prefix}:${start}`;
      const endMark = `${prefix}:${end}`;
      if (!marks.has(startMark) || !marks.has(endMark)) {
        return;
      }
      const performanceMeasure = performance.measure(measureName, startMark, endMark);
      const measure = {
        label,
        name,
        durationMs: performanceMeasure.duration
      };
      measures.push(measure);
      options.onMeasure?.(measure);
    },
    clear(): void {
      for (const mark of marks) {
        performance.clearMarks(mark);
      }
    }
  };
}

function isLoaderPerformanceEnabled(options: LoaderPerformanceOptions): boolean {
  return (
    typeof performance !== "undefined" &&
    typeof performance.mark === "function" &&
    typeof performance.measure === "function" &&
    (options.enabled === true ||
      typeof options.onMeasure === "function" ||
      (globalThis as LoaderPerformanceGlobal)[loaderPerformanceFlag] === true)
  );
}

function sanitizePerformanceLabel(label: string): string {
  return label.replace(/\s+/g, " ").slice(0, 80);
}
