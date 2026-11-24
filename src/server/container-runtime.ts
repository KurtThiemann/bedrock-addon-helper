export interface PortMapping {
    readonly port: number;
    readonly protocol: "tcp" | "udp";
}

export interface ContainerSpec {
    readonly name: string;
    readonly image: string;
    readonly env: Readonly<Record<string, string>>;
    /** Published with the same port number on the host and in the container. */
    readonly ports: readonly PortMapping[];
    readonly volumes: readonly { readonly host: string; readonly container: string }[];
    readonly labels: Readonly<Record<string, string>>;
    /** `uid:gid` to run as, so files in mounted volumes belong to the user. */
    readonly user?: string | undefined;
}

export type ContainerState = "running" | "stopped";

/** The container operations test servers need; implemented with the docker CLI. */
export interface ContainerRuntime {
    /** Null if the container doesn't exist. */
    state(name: string): Promise<ContainerState | null>;
    /** Pulls the image if needed and starts a new container (replacing a stopped one). */
    run(spec: ContainerSpec): Promise<void>;
    stop(name: string, timeoutSeconds: number): Promise<void>;
    /** Removes the container; does nothing if it doesn't exist. */
    remove(name: string): Promise<void>;
    exec(name: string, command: readonly string[]): Promise<void>;
    /** Connects the terminal to the container's console until it detaches or ends. */
    attach(name: string): Promise<void>;
    /** Prints the container's output to the terminal. */
    logs(name: string, options: { follow: boolean; tail?: number | undefined }): Promise<void>;
    /**
     * Passes every line the container has printed, and prints from now on,
     * to `onLine`. Resolves when the container stops or `signal` is aborted.
     */
    followLogs(name: string, onLine: (line: string) => void, signal: AbortSignal): Promise<void>;
}
