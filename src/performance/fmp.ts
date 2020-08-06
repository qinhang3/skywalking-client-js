/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { ICalScore, Els } from './type';

const getStyle = (element: Element | any, attr: any) => {
  if (window.getComputedStyle) {
    return window.getComputedStyle(element, null)[attr];
  } else {
    return element.currentStyle[attr];
  }
};

enum ELE_WEIGHT {
  SVG = 2,
  IMG = 2,
  CANVAS = 4,
  OBJECT = 4,
  EMBED = 4,
  VIDEO = 4,
}

const START_TIME: number = performance.now();
const IGNORE_TAG_SET: string[] = ['SCRIPT', 'STYLE', 'META', 'HEAD', 'LINK'];
const LIMIT: number = 3000;
const WW: number = window.innerWidth;
const WH: number = window.innerHeight;
const DELAY: number = 500;

class FMPTiming {
  public fmpTime: number = 0;
  private statusCollector: Array<{time: number}> = [];
  private flag: boolean = true;
  private observer: MutationObserver = null;
  private callbackCount: number = 0;
  private entries: any = {};

  constructor() {
    this.initObserver();
  }
  private getFirstSnapShot(): void {
    const time: number = performance.now();
    const $body: HTMLElement = document.body;
    if ($body) {
      this.setTag($body, this.callbackCount);
    }
    this.statusCollector.push({
      time,
    });
  }
  private initObserver() {
    this.getFirstSnapShot();
    this.observer = new MutationObserver(() => {
      this.callbackCount += 1;
      const time = performance.now();
      const $body: HTMLElement = document.body;
      if ($body) {
        this.setTag($body, this.callbackCount);
      }
      this.statusCollector.push({
        time,
      });
    });
    this.observer.observe(document, {
      childList: true,
      subtree: true,
    });
    if (document.readyState === 'complete') {
      this.calculateFinalScore();
    } else {
      window.addEventListener('load', () => {
        this.calculateFinalScore();
      }, false);
    }
  }
  private calculateFinalScore() {
    if (MutationEvent && this.flag) {
      if (this.checkNeedCancel(START_TIME)) {
        this.observer.disconnect();
        this.flag = false;
        const res = this.getTreeScore(document.body);
        let tp: ICalScore = null;
        res.dpss.forEach((item: any) => {
          if (tp && tp.st) {
            if (tp.st < item.st) {
              tp = item;
            }
          } else {
            tp = item;
          }
        });
        performance.getEntries().forEach((item: PerformanceResourceTiming) => {
          this.entries[item.name] = item.responseEnd;
        });
        if (!tp) {
          return false;
        }
        const resultEls: Els = this.filterResult(tp.els);
        const fmpTiming: number = this.getFmpTime(resultEls);
        this.fmpTime = fmpTiming;
    } else {
      setTimeout(() => {
        this.calculateFinalScore();
      }, DELAY);
    }
    }
  }
  private getFmpTime(resultEls: Els): number {
    let rt = 0;
    resultEls.forEach((item: any) => {
      let time: number = 0;
      if (item.weight === 1) {
        const index: number = parseInt(item.$node.getAttribute('fmp_c'), 10);
        time = this.statusCollector[index].time;
      } else if (item.weight === 2) {
        if (item.$node.tagName === 'IMG') {
          time = this.entries[(item.$node as HTMLImageElement).src];
        } else if (item.$node.tagName === 'SVG') {
          const index: number = parseInt(item.$node.getAttribute('fmp_c'), 10);
          time = this.statusCollector[index].time;
        } else {
          const match = getStyle(item.$node, 'background-image').match(/url\(\"(.*?)\"\)/);
          let url: string;
          if (match && match[1]) {
            url = match[1];
          }
          if (!url.includes('http')) {
            url = location.protocol + match[1];
          }
          time = this.entries[url];
        }
      } else if (item.weight === 4) {
        if (item.$node.tagName === 'CANVAS') {
          const index: number = parseInt(item.$node.getAttribute('fmp_c'), 10);
          time = this.statusCollector[index].time;
        } else if (item.$node.tagName === 'VIDEO') {
          time = this.entries[(item.$node as HTMLVideoElement).src];
          if (!time) {
            time = this.entries[(item.$node as HTMLVideoElement).poster];
          }
        }
    }
      if (typeof time !== 'number') {
        time = 0;
      }
      if (rt < time) {
        rt = time;
      }
    });
    return rt;
  }
  private filterResult(els: Els): Els {
    if (els.length === 1) {
      return els;
    }
    let sum: number = 0;
    els.forEach((item: any) => {
      sum += item.st;
    });
    const avg: number = sum / els.length;
    return els.filter((item: any) => {
      return item.st > avg;
    });
  }
  private checkNeedCancel(start: number): boolean {
    const time: number = performance.now() - start;
    const lastCalTime: number = this.statusCollector.length > 0
      ? this.statusCollector[this.statusCollector.length - 1].time
      : 0;
    return time > LIMIT || (time - lastCalTime > 1000);
  }
  private getTreeScore(node: Element): ICalScore | any {
    if (!node) {
      return {};
    }
    const dpss = [];
    const children: any = node.children;
    for (const child of children) {
      if (!child.getAttribute('fmp_c')) {
        continue;
      }
      const s = this.getTreeScore(child);
      if (s.st) {
        dpss.push(s);
      }
    }

    return this.calcaulteScore(node, dpss);
  }
  private calcaulteScore($node: Element, dpss: ICalScore[]): ICalScore {
    const {
      width,
      height,
      left,
       top,
    } = $node.getBoundingClientRect();
    let isInViewPort: boolean = true;
    if (WH < top || WW < left) {
      isInViewPort = false;
    }
    let sdp: number = 0;
    dpss.forEach((item: any) => {
      sdp += item.st;
    });
    let weight: number = Number(ELE_WEIGHT[$node.tagName as any]) || 1;
    if (weight === 1
      && getStyle($node, 'background-image')
      && getStyle($node, 'background-image') !== 'initial'
      && getStyle($node, 'background-image') !== 'none') {
      weight = ELE_WEIGHT.IMG;
    }
    let st: number = isInViewPort ? width * height * weight : 0;
    let els = [{ $node, st, weight }];
    const root = $node;
    const areaPercent = this.calculateAreaParent($node);
    if (sdp > st * areaPercent || areaPercent === 0) {
      st = sdp;
      els = [];
      dpss.forEach((item: any) => {
        els = els.concat(item.els);
      });
    }
    return {
      dpss,
      st,
      els,
      root,
    };
  }
  private calculateAreaParent($node: Element): number {
    const {
      left,
      right,
      top,
      bottom,
      width,
      height,
    } = $node.getBoundingClientRect();
    const winLeft: number = 0;
    const winTop: number = 0;
    const winRight: number = WW;
    const winBottom: number = WH;
    const overlapX = (right - left) + (winRight - winLeft) - (Math.max(right, winRight) - Math.min(left, winLeft));
    const overlapY = (bottom - top) + (winBottom - winTop) - (Math.max(bottom, winBottom) - Math.min(top, winTop));

    if (overlapX <= 0 || overlapY <= 0) {
    return 0;
    }
    return (overlapX * overlapY) / (width * height);
  }
  private setTag(target: Element, callbackCount: number): void {
    const tagName: string = target.tagName;
    if (IGNORE_TAG_SET.indexOf(tagName) === -1) {
      const $children: HTMLCollection = target.children;
      if ($children && $children.length > 0) {
        for (let i = $children.length - 1; i >= 0; i--) {
          const $child: Element = $children[i];
          const hasSetTag = $child.getAttribute('fmp_c') !== null;
          if (!hasSetTag) {
            const {
              left,
              top,
              width,
              height,
            } = $child.getBoundingClientRect();
            if (WH < top || WW < left || width === 0 || height === 0) {
              continue;
            }
            $child.setAttribute('fmp_c', `${callbackCount}`);
        }
          this.setTag($child, callbackCount);
        }
      }
    }
  }
}

export default FMPTiming;
