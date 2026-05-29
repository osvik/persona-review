import React from "react";
import { Box, Text } from "ink";

interface Props {
  hints: string[];
}

export function KeyHint({ hints }: Props) {
  return (
    <Box marginTop={1}>
      <Text dimColor>{hints.join("  •  ")}</Text>
    </Box>
  );
}
