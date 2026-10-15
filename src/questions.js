export const categories = [
  { id: 'light', name: '轻松破冰', subtitle: '从一个小问题开始', color: '#dc7f58' },
  { id: 'wild', name: '脑洞时刻', subtitle: '一起想些不一样的', color: '#8b8b63' },
  { id: 'deep', name: '认真一点', subtitle: '慢慢了解真实的你', color: '#8c79a1' },
];
const bank = {
  light: [
    '如果明天突然放假，你最想拉我去哪里？',
    '最近有什么不起眼的小事，让你开心了很久？',
    '如果用一道菜介绍自己，你会选什么？',
    '你手机相册里，哪张照片最有故事？',
    '有没有一首歌，一听就能让你回到某个夏天？',
    '周末的早晨，你理想中的第一件事是什么？',
    '如果我们开一家小店，你想卖什么？',
    '你最近一次忍不住笑出声，是因为什么？',
    '你有什么别人猜不到的小爱好？',
    '哪种天气，会让你特别想出门走走？',
    '你愿意为了哪一家小吃，专门去一座城市？',
    '如果现在就能点一份宵夜，你会选什么？',
  ],
  wild: [
    '如果我们能交换一天人生，你最想先做什么？',
    '给我们两个人的冒险故事起一个名字，会是什么？',
    '假如能把一种声音装进瓶子，你会装什么？',
    '如果你的猫或狗会说话，它会先吐槽你什么？',
    '如果只能带三样东西去月球，你会怎么选？',
    '如果我们一起参加综艺，你觉得谁会先出糗？',
    '如果可以给生活加一个快捷键，你想要什么功能？',
    '假如一周有八天，多出来那天你想怎么过？',
    '如果未来的自己寄来一张明信片，你希望上面写什么？',
    '如果一段回忆可以变成一种味道，你会选哪一段？',
    '如果我们要发明一个新节日，应该庆祝什么？',
    '你想拥有哪种没什么用、却很有趣的超能力？',
  ],
  deep: [
    '什么时候，你最能感觉到自己被认真地在乎着？',
    '有没有一件事，你以前很在意，现在却放下了？',
    '当你心情不好时，你希望别人陪着，还是留一点空间？',
    '你希望别人多了解你的哪一面？',
    '你最近为自己感到骄傲的一件事是什么？',
    '如果可以对五年前的自己说一句话，你会说什么？',
    '对你来说，一个让人安心的关系是什么样的？',
    '你有什么一直想试、但还没迈出第一步的事？',
    '你认为什么样的普通日子，也值得被纪念？',
    '你希望未来的生活里，始终保留哪一个小习惯？',
    '有没有一个人，让你重新理解了温柔？',
    '此时此刻，你最想收到什么样的鼓励？',
  ],
};
export const questions = Object.entries(bank).flatMap(([category, texts]) => texts.map((text, i) => ({ id: `${category}-${i}`, category, text })));
export function questionFor(room) {
  const pool = questions.filter(q => q.category === (room.category || 'light'));
  // The room and index, rather than each browser's random state, determine the card.
  const seed = [...room.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return pool[(seed + room.question_index) % pool.length];
}
export function validateName(value) {
  const name = value.trim();
  if (!name || name.length > 20) throw new Error('昵称需要 1～20 个字。');
  return name;
}
export function validateMessage(value) {
  const text = value.trim();
  if (!text || text.length > 1000) throw new Error('消息需要 1～1000 个字。');
  return text;
}
