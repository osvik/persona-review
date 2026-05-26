import React from "react";
import { Box, Text } from "ink";

interface Props {
  lines: string[];
  visible?: number;
}

export function StatusLog({ lines, visible = 12 }: Props) {
  const tail = lines.slice(-visible);
  return (
    <Box flexDirection="column">
      {tail.map((line, i) => (
        <Text key={`${lines.length - tail.length + i}`} dimColor>
          {line}
        </Text>
      ))}
    </Box>
  );
}
