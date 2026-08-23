import { Injectable } from '@angular/core';
import { from, Observable } from 'rxjs';

/**
 * Test service demonstrating native fetch() usage
 * This does NOT require HttpClient or provideHttpClient()
 */
@Injectable({
  providedIn: 'root'
})
export class TestHttpService {
  constructor() {
    console.log('✅ TestHttpService: Using native fetch() - no HttpClient needed!');
  }

  /**
   * Test HTTP call using native fetch() API
   * This works with external URLs without any URL manipulation
   */
  testFetchCall(): Observable<string> {
    console.log('🧪 TestHttpService: Making test fetch call...');

    return from(
      fetch('https://api.github.com/zen', {
        method: 'GET'
      }).then(async response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
      })
    );
  }

  /**
   * Simple test to verify the service is instantiated
   */
  testInjection(): string {
    return 'Native fetch() is available and working - no HttpClient dependency!';
  }
}
