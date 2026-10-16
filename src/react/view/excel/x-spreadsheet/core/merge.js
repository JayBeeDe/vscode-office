import { CellRange } from './cell_range';

class Merges {
  constructor(d = []) {
    this._ = d;
  }

  forEach(cb) {
    this._.forEach(cb);
  }

  deleteWithin(cr) {
    this._ = this._.filter(it => !it.within(cr));
  }

  getFirstIncludes(ri, ci) {
    for (let i = 0; i < this._.length; i += 1) {
      const it = this._[i];
      if (it.includes(ri, ci)) {
        return it;
      }
    }
    return null;
  }

  filterIntersects(cellRange) {
    return new Merges(this._.filter(it => it.intersects(cellRange)));
  }

  intersects(cellRange) {
    for (let i = 0; i < this._.length; i += 1) {
      const it = this._[i];
      if (it.intersects(cellRange)) {
        // console.log('intersects');
        return true;
      }
    }
    return false;
  }

  union(cellRange) {
    let cr = cellRange;
    this._.forEach((it) => {
      if (it.intersects(cr)) {
        cr = it.union(cr);
      }
    });
    return cr;
  }

  add(cr) {
    this.deleteWithin(cr);
    this._.push(cr);
  }

  // type: row | column
  shift(type, index, n, cbWithin) {
    this._.forEach((cellRange) => {
      const {
        sri, sci, eri, eci,
      } = cellRange;
      const range = cellRange;
      if (type === 'row') {
        if (sri >= index) {
          range.sri += n;
          range.eri += n;
        } else if (sri < index && index <= eri) {
          range.eri += n;
          cbWithin(sri, sci, n, 0);
        }
      } else if (type === 'column') {
        if (sci >= index) {
          range.sci += n;
          range.eci += n;
        } else if (sci < index && index <= eci) {
          range.eci += n;
          cbWithin(sri, sci, 0, n);
        }
      }
    });
  }

  // type: row | column; the rows (or columns) start..end are deleted
  deleteSpan(type, start, end) {
    const n = end - start + 1;
    const next = [];
    this._.forEach((range) => {
      const it = range;
      const [s, e] = type === 'row' ? [it.sri, it.eri] : [it.sci, it.eci];
      let ns = s;
      let ne = e;
      if (s > end) {
        ns -= n;
        ne -= n;
      } else if (e >= start) {
        // the merge overlaps the deleted block: keep what is outside it
        ns = Math.min(s, start);
        ne = e > end ? e - n : start - 1;
      }
      if (ne < ns) return; // entirely deleted
      if (type === 'row') {
        it.sri = ns;
        it.eri = ne;
      } else {
        it.sci = ns;
        it.eci = ne;
      }
      if (it.sri === it.eri && it.sci === it.eci) return; // a single cell is no merge
      next.push(it);
    });
    this._ = next;
  }

  move(cellRange, rn, cn) {
    this._.forEach((it1) => {
      const it = it1;
      if (it.within(cellRange)) {
        it.eri += rn;
        it.sri += rn;
        it.sci += cn;
        it.eci += cn;
      }
    });
  }

  setData(merges) {
    this._ = (merges || []).map(merge => CellRange.valueOf(merge));
    return this;
  }

  getData() {
    return this._.map(merge => merge.toString());
  }
}

export default {};
export {
  Merges,
};
