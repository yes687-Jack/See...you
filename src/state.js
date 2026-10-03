// 全局流程状态（后续可替换为云端同步实现，调用方无需改动）
export const G = {
  currentScene: 0,
  mode: 'single', // single | build | party
  partyCount: 4,
  partyPlayers: [],
  partyIdx: 0,
  roomCode: ''
};
