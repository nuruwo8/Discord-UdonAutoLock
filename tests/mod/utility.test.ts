import { getNowAndToDayJst, getNowJst, getToDayJst } from '@/src/mod/utility';

describe('get time', () => {
   const date = new Date('2022/10/14 12:34:56');

   beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(date);
   });

   describe('getNowJST()', () => {
      test('2022-10-14 12-34-56 を返す', () => {
         expect(getNowJst()).toEqual('2022-10-14 12-34-56');
      });
   });

   describe('getToDay()', () => {
      test('2022-10-14 を返す', () => {
         expect(getToDayJst()).toEqual('2022-10-14');
      });
   });

   describe('getNowJSTAndToDay()', () => {
      test('2022-10-14 12-34-56 を返す', () => {
         const { nowJst } = getNowAndToDayJst();
         expect(nowJst).toEqual('2022-10-14 12-34-56');
      });

      test('2022-10-14 を返す', () => {
         const { todayJst: today } = getNowAndToDayJst();
         expect(today).toEqual('2022-10-14');
      });
   });

   afterEach(() => {
      jest.useRealTimers();
   });
});
