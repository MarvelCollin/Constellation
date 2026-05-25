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

export const resourceChannels: ResourceChannel[] = [
  {
    name: "RAM",
    description: "Reserve memory safely before joining shared training workloads.",
    capacity: "Not scanned",
    state: "Waiting",
  },
  {
    name: "GPU",
    description: "Detect local accelerators and expose compatible compute queues.",
    capacity: "Not scanned",
    state: "Waiting",
  },
  {
    name: "Storage",
    description: "Allocate model cache space for checkpoints, datasets, and runtime images.",
    capacity: "Not scanned",
    state: "Waiting",
  },
  {
    name: "Network",
    description: "Measure bandwidth and prepare hosting routes for local inference endpoints.",
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
