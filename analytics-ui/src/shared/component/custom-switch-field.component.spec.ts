import { CustomSwitchFieldComponent } from './custom-switch-field.component';
import { FieldType } from '@ngx-formly/core';

describe('CustomSwitchFieldComponent', () => {
  it('is a Formly field type', () => {
    expect(Object.getPrototypeOf(CustomSwitchFieldComponent)).toBe(FieldType);
  });
});
