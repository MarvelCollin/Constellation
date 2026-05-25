export type ResourceChannel = {
  name: string;
  description: string;
  capacity: string;
  state: string;
};

export type SetupStep = {
  title: string;
  detail: string;
};

export type TimelineAction = {
  label: string;
  title: string;
  detail: string;
  tone: "thinking" | "grep" | "read" | "edit" | "done";
};

export const resourceChannels: ResourceChannel[] = [
  {
    name: "RAM",
    description: "Reserve memory before joining shared training jobs.",
    capacity: "Not scanned",
    state: "Waiting",
  },
  {
    name: "GPU",
    description: "Detect accelerators and expose compatible compute queues.",
    capacity: "Not scanned",
    state: "Waiting",
  },
  {
    name: "Storage",
    description: "Allocate cache space for checkpoints and runtime images.",
    capacity: "Not scanned",
    state: "Waiting",
  },
  {
    name: "Network",
    description: "Measure bandwidth for local inference endpoints.",
    capacity: "Not scanned",
    state: "Waiting",
  },
];

export const setupSteps: SetupStep[] = [
  {
    title: "Hardware scan",
    detail: "Read device limits before any shared resource is enabled.",
  },
  {
    title: "Allocation rules",
    detail: "Define local caps for training, hosting, cache, and background traffic.",
  },
  {
    title: "Node identity",
    detail: "Create the local identity used by future cluster discovery.",
  },
];

export const timelineActions: TimelineAction[] = [
  {
    label: "Thinking",
    title: "Plan resource scan",
    detail: "Decide which local probes can run without starting a workload.",
    tone: "thinking",
  },
  {
    label: "Grepping",
    title: "Find device tools",
    detail: "Locate Python, NVIDIA tooling, memory counters, and network interfaces.",
    tone: "grep",
  },
  {
    label: "Reading",
    title: "Read hardware limits",
    detail: "Collect CPU cores, RAM, GPU name, VRAM, and driver metadata.",
    tone: "read",
  },
  {
    label: "Editing",
    title: "Write allocation policy",
    detail: "Save safe caps before the node can train or host AI workloads.",
    tone: "edit",
  },
  {
    label: "Done",
    title: "Ready for cluster join",
    detail: "The desktop can advertise capacity only after owner approval.",
    tone: "done",
  },
];
