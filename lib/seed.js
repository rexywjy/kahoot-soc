export const starterQuiz = {
  id: 'starter-brain-break', title: 'The ultimate brain break', description: 'A little space, a little science, a whole lot of friendly competition.', emoji: '🚀', color: 'violet',
  defaults: { duration: 15, points: 100, negative: true, penalty: 25, penaltyMatchesPoints: false },
  questions: [
    { text: 'Which planet has the most iconic rings? 🪐', type: 'single', options: ['Mars', 'Saturn', 'Venus', 'Mercury'], correct: [1], duration: 15, points: 100, negative: true, penalty: 25, penaltyMatchesPoints: false },
    { text: 'Spot the prime numbers. Select all that apply! 🔢', type: 'multiple', options: ['2', '9', '11', '15'], correct: [0, 2], duration: 15, points: 100, negative: true, penalty: 25, penaltyMatchesPoints: false },
    { text: 'What does the “www” in a website address stand for?', type: 'single', options: ['World Wide Web', 'World Web Wave', 'Wide World Wire', 'Web Without Walls'], correct: [0], duration: 15, points: 100, negative: true, penalty: 25, penaltyMatchesPoints: false },
    { text: 'Which of these animals are mammals? 🐾', type: 'multiple', options: ['Dolphin', 'Shark', 'Bat', 'Penguin'], correct: [0, 2], duration: 15, points: 100, negative: true, penalty: 25, penaltyMatchesPoints: false },
    { text: 'Final round! How many sides does a hexagon have? ✨', type: 'single', options: ['5', '6', '7', '8'], correct: [1], duration: 15, points: 100, negative: true, penalty: 25, penaltyMatchesPoints: false }
  ]
};
