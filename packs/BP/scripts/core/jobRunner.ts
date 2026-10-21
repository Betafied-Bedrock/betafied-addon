import { system } from "@minecraft/server";
import { reportError, runCatching } from "./errorReporter.js";

export interface JobOptions {
    system?: string;
    operation?: string;
    onError?: (error: unknown) => void;
    onFinally?: () => void;
}

export interface BatchJobOptions extends JobOptions {
    batchSize?: number;
}

export class JobRunner {
    private readonly activeJobs: Set<number>;

    constructor() {
        this.activeJobs = new Set<number>();
    }

    // Starts the job and hands back its id, or `undefined` when the engine refused to start it.
    public run(
        generator: Generator<void, void, void>,
        options?: JobOptions
    ): number | undefined {
        const box = { id: -1 };
        const wrapped = JobRunner.wrap(generator, options, () => {
            if (box.id >= 0) {
                this.activeJobs.delete(box.id);
            }
        });

        const started = runCatching(
            { system: options?.system ?? "jobRunner", operation: "startJob" },
            () => system.runJob(wrapped),
            (err) => {
                options?.onError?.(err);
                options?.onFinally?.();
                return undefined;
            }
        );

        if (started === undefined) {
            return undefined;
        }

        box.id = started;
        this.activeJobs.add(started);
        return started;
    }

    public forEach<T>(
        items: Iterable<T>,
        handler: (item: T, index: number) => void,
        options?: BatchJobOptions
    ): number | undefined {
        return this.run(JobRunner.batch(items, handler, options?.batchSize), options);
    }

    public has(jobId: number): boolean {
        return this.activeJobs.has(jobId);
    }

    public clear(jobId: number): void {
        this.activeJobs.delete(jobId);
        JobRunner.clear(jobId);
    }

    public clearAll(): void {
        for (const id of this.activeJobs) {
            JobRunner.clear(id);
        }
        this.activeJobs.clear();
    }

    public get activeCount(): number {
        return this.activeJobs.size;
    }

    private static clear(jobId: number): void {
        runCatching(
            { system: "jobRunner", operation: "clearJob" },
            () => {
                system.clearJob(jobId);
            }
        );
    }

    private static *batch<T>(
        items: Iterable<T>,
        handler: (item: T, index: number) => void,
        batchSize = 1
    ): Generator<void, void, void> {
        const size = Math.max(1, Math.floor(batchSize));
        let processed = 0;
        let index = 0;
        for (const item of items) {
            handler(item, index++);
            processed++;
            if (processed >= size) {
                processed = 0;
                yield;
            }
        }
    }

    private static *wrap(
        generator: Generator<void, void, void>,
        options?: JobOptions,
        onComplete?: () => void
    ): Generator<void, void, void> {
        const systemName = options?.system ?? "jobRunner";

        try {
            while (true) {
                const res = generator.next();
                if (res.done) break;
                yield;
            }
        } catch (err) {
            // Callbacks go through runCatching so a failing handler cannot abort the job already unwinding.
            runCatching({ system: systemName, operation: "onError" }, () => options?.onError?.(err));
            reportError(
                {
                    system: systemName,
                    operation: options?.operation ?? "execute"
                },
                err
            );
        } finally {
            runCatching({ system: systemName, operation: "onFinally" }, () => options?.onFinally?.());
            onComplete?.();
        }
    }
}
