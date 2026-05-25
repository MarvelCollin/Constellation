export type ResourceChannel = {
  name: string;
  description: string;
};

export const resourceChannels: ResourceChannel[] = [
  {
    name: "CPU",
    description: "Count local execution cores for scheduler planning.",
  },
  {
    name: "RAM",
    description: "Reserve memory before joining shared training jobs.",
  },
  {
    name: "GPU",
    description: "Detect accelerators and expose compatible compute queues.",
  },
  {
    name: "Storage",
    description: "Allocate cache space for checkpoints and runtime images.",
  },
];
