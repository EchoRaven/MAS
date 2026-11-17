// Adapted from MindRoom (https://github.com/mindroom-ai/mindroom,
// frontend/src/components/shared/styles.ts), Apache License 2.0.
export const sharedStyles = {
  panel: {
    container: "glass-panel h-full flex flex-col overflow-hidden rounded-xl",
    header: "px-3 pt-3 pb-2 sm:px-4 sm:pt-4 flex-shrink-0",
    content: "px-2 pb-2 sm:px-3 sm:pb-3 flex-1 overflow-y-auto min-h-0",
  },
  header: {
    title: "text-base sm:text-lg font-semibold flex items-center gap-2",
  },
  search: {
    container: "relative mt-2",
    input: "pl-8 h-10 sm:h-9",
    icon: "absolute left-2 top-3 sm:top-2.5 h-4 w-4 text-muted-foreground",
  },
  item: {
    containerCard:
      "cursor-pointer rounded-lg outline-none transition-colors duration-150 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    selectedCard: "bg-active hover:bg-active",
    cardContent: "p-3",
    cardTitle: "font-medium text-sm",
    cardDescription: "text-xs text-muted-foreground mt-1",
    badgeContainer: "flex flex-wrap items-center gap-1.5 mt-1.5",
  },
  empty: {
    container: "text-center py-6 text-muted-foreground",
    icon: "h-10 w-10 mx-auto mb-2 opacity-20",
    title: "text-sm",
    subtitle: "text-xs mt-1",
  },
} as const;
