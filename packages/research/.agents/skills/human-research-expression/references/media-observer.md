# 原片观察控制：可复用组件

用于已经有必要原片、读者需要快退、细步查看或反复观察同一区间的单份HTML报告。静态图已足够时不用它；不抓取媒体、不复现游戏、不增加机位或声画证据。当前组件已接入表达样例，实际页面视觉与操作效果仍按宿主验收。

## 阅读层级与能力

主区保留画面、时间条、播放／暂停、快退／快进1秒、速度和回到开头。逐步细看与A—B区间放在可展开区域，默认不占满操作区。区间可输入秒数，也可取当前位置；循环只在手动开启后生效。用稳定的状态文字解释加载、定位、区间错误和播放失败。

细步可选约1/30秒或0.25秒，选择只影响所属实例；保留正常速度入口，用慢放查细节而不替代正常节奏观察。

控制与视频状态绑定：原片未就绪时禁用依赖时长的动作；时间定位夹到首尾；无效区间保留原值；离开循环区间时关闭循环以尊重用户定位；更换来源后重置旧区间。时间步进为约1/30秒，不是精确逐帧；播放以媒体事件和play Promise为准。常规按钮／输入支持原生键盘；聚焦组件外框时，空格切播放、左右键定位1秒，输入框和按钮自身按原生行为操作。

备用控件改变倍率时，界面同步实际倍率，正确区分正常、慢放与快放。卸载会取消尚未成功的播放；已经开始的播放保留给恢复的原生控件。晚到播放结果只能清理仍属于旧实例的媒体，不能暂停已被新实例接管的播放。

## 唯一维护源与接入

- [player.js](../assets/media-observer/player.js)：`markup(videoHTML)`、`mount(root)`、纯控制器与时间格式化。无外部依赖；每个实例独立，重复mount不叠加监听，`destroy()`卸载并恢复原生控件。
- [player.css](../assets/media-observer/player.css)：只作用于`.media-observer`，适配窄屏，不改变报告正文／导航。
- [test.cjs](../assets/media-observer/test.cjs)：用`node --test <此文件>`核对时间边界、循环、异步播放和双实例／卸载；不是浏览器渲染或真实媒体测试。

制作脚本读取JS和CSS内联到当前报告，调用`markup()`传入宿主已经核准的`<video controls …>`片段，再对对应根调用`mount(root)`。`videoHTML`是可信构建输入，不接受未审查网页HTML或用户字符串；来源、字幕与素材身份仍由宿主维护。多实例的video ID由宿主保证唯一，组件自身不新增固定ID。保留原生`controls`作为脚本未启动的入口；装载后组件接管，读者可切换备用播放控件。

```javascript
// 构建时：生成完整控制区；将player.css和player.js内联一次。
const player = require('./assets/media-observer/player.js');
const html = player.markup(verifiedVideoHTML);
// 页面启动后：逐个挂载；组件只接管所属video。
document.querySelectorAll('[data-media-observer]').forEach(root => {
  ResearchMediaObserver.mount(root);
});
```

不要在成品内链接私人机器上的组件路径。更新组件后重新内联，绑定实际成品版本，并复核受影响操作；旧报告不自动回写。不同宿主至少验证两个实例互不干扰、重复挂载、卸载恢复、不可播放、未就绪、区间首尾和窄屏／键盘，再据用途决定采用。单例接入与合成测试不等于跨报告稳定性已证实。

实现参考：[MDN play()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play)说明启动由Promise成功／失败决定；[MDN currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime)说明按秒定位及精度限制。宿主媒体格式、浏览器和真实操作仍需实际验收。
