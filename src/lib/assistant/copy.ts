/**
 * Every user-facing string of Ask ResNeo, in one place so the no-em-dash rule can be tested
 * (CLAUDE.md: never an em-dash in copy a user can read).
 */
export const ASSISTANT_COPY = {
  launcher: 'Ask ResNeo',
  title: 'Ask ResNeo',
  description: "Answers come from the ResNeo help centre. Please don't include client details.",
  placeholder: 'Ask how to do something in ResNeo',
  send: 'Send',
  stop: 'Stop',
  thinking: 'Finding the answer',
  newConversation: 'Start again',
  disclaimer: 'Ask ResNeo can make mistakes. Check the linked article for the full steps.',
  feedbackPrompt: 'Was this helpful?',
  feedbackYes: 'Yes',
  feedbackNo: 'No',
  feedbackCommentPlaceholder: 'What was missing or wrong? (optional)',
  feedbackCommentSend: 'Send feedback',
  feedbackThanks: 'Thanks, that helps us improve the help centre.',
  sendToSupport: 'Send this to support',
  handoffSubject: 'Question from Ask ResNeo',
  rateLimited: "You've asked a lot of questions in a short time. Please try again in a few minutes, or use the Support form.",
  dailyCap: "This venue has reached today's limit for Ask ResNeo. It resets at midnight. The Support form is always available.",
  error: 'Something went wrong while answering. Please try again, or send your question to Support.',
  unavailable: 'Ask ResNeo is not available right now. The Support form is always available.',
  supportCardTitle: 'Ask ResNeo first',
  supportCardBody:
    'Get instant answers about how ResNeo works, taken from the help centre. If it cannot help, you can send your question to us from there.',
  supportCardAction: 'Open Ask ResNeo',
} as const;
