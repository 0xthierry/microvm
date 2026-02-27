import type { HelpInput } from "./input";
import { HelpTopicNotFoundError } from "./errors";

type HelpTopic = {
  topic: string;
  summary: string;
  usage: string;
};

type HelpContext = {
  topics: HelpTopic[];
  outputRootHelp: () => void;
  outputCommandHelp: (topic: string) => boolean;
};

export const handleHelp = async (input: HelpInput, context: HelpContext): Promise<void> => {
  if (!input.topic) {
    if (input.outputJson) {
      console.log(
        JSON.stringify(
          {
            command: "help",
            topics: context.topics,
          },
          null,
          2,
        ),
      );
      return;
    }

    context.outputRootHelp();
    return;
  }

  const topic = input.topic;
  const matchingTopic = context.topics.find((entry) => entry.topic === topic);

  if (input.outputJson) {
    if (!matchingTopic) {
      throw new HelpTopicNotFoundError(topic);
    }

    console.log(
      JSON.stringify(
        {
          command: "help",
          topic,
          usage: matchingTopic.usage,
          summary: matchingTopic.summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!context.outputCommandHelp(topic)) {
    throw new HelpTopicNotFoundError(topic);
  }
};
