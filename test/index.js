import { expect } from 'chai';
import * as sqs from '../src/index';

describe('SQS', () => {
  describe('getUrl(...)', () => {
    it('should throw error when not initialized', () => {
      expect(sqs.getUrl).to.throw(/init/);
    });
  });
});
